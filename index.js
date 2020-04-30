var i32 = Symbol('i32'), i64 = Symbol('i64')
var f32 = Symbol('i32'), f64 = Symbol('f64')


var {AND,OR,GROUP,MANY,MORE} = require('stack-expression')
var varint = require('varint')

function BUFFER(b) {
  return function (input, start) {
    if(b.compare(input, start, b.length) === 0)
      return {length: b.length, groups: []}
  }
}

function Byte (byte, sym) {
  return function (input, start) {
    if(input[start] === byte)
      return {length: 1, groups: sym ? sym : []}
  }
}

function UIntLE (i, sym) {
  return function (input, start) {
    if(input.readUInt32LE(start) === i)
      return {length: 4, groups: sym ? [sym, i] : []}
  }
}

//varint captures by default, since we generally want it.
function Varint (input, start) {
  var i = varint.decode(input, start)
  return {
    length: varint.decode.bytes,
    groups: i
  }
}

function id (e) { return e }

function Bytes (map) {
  return function (input, start, end) {
    var length = varint.decode(input, start)
    var bytes = varint.decode.bytes

    return {
      length: bytes+length,
      groups: [(map||id)(input.slice(start+bytes, start+bytes+length))]
    }
  }
}

function Bound (subrule, sym) {
  return function (input, start) {
    var length = varint.decode(input, start)
    var bytes = varint.decode.bytes
    var _start = start+bytes
    var count = varint.decode(input, _start)
    _start = _start+bytes
    var end = start + bytes + length
    var g = sym ? [sym]:[]
    while(_start < end) {
      var m = subrule(input, _start, end)
      g.push(m.groups)
      _start += m.length
    }
    return {
      length: end - start,
      groups: [g]
    }
  }
}


//a vector, bounded by a varint32
//I think it's byte length, not element length?
function LengthDelimited (subrule, sym) {
  return function (input, start) {
    var length = varint.decode(input, start)
    var bytes = varint.decode.bytes
    var _start = start+bytes
    var end = start + bytes + length
    var g = sym ? [sym]:[]
    while(_start < end) {
      var m = subrule(input, _start, end)
      g.push(m.groups)
      _start += m.length
    }
    return {
      length: end - start,
      groups: [g]
    }
  }
}

function CountDelimited (subrule, sym) {
  return function (input, start) {
    var count = varint.decode(input, start)
    var _start = start+varint.decode.bytes
    var g = []
    for(var i = 0; i < count; i++) {
      var m = subrule(input, _start)
      console.log('cd', count, i, m, input.slice(_start, _start+5))
      g.push(m.groups)
      _start += m.length
    }
    return {
      length: _start - start,
      groups: sym ? [sym, g] : g
    }
  }


}


var Name = Bytes(String)

var ValType = OR(
  Byte(0x7F, i32),
  Byte(0x7E, i64),
  Byte(0x7D, f32),
  Byte(0x7C, f64)
)
var Result = LengthDelimited(ValType, Symbol('result'))
var Params = LengthDelimited(ValType, Symbol('params'))

var func = Symbol('func')
var FuncType = GROUP(AND(Byte(0x64, func), Params, Result))
var MemIdx = Varint

function Code (input, start, end) {
  var length = varint.decode(input, start)
  var bytes = varint.decode.bytes
  var count = varint.decode(input, bytes+start)
  var _start = start+bytes+varint.decode.bytes
  var end = start + bytes + length
  var g = []
  while(_start < end) {
    var m = Bytes()(input, _start)
    _start += m.length
    g.push(m.groups)
  }
  return {length: bytes+length, groups: g}
}


function Range (low, high, rule, sym) {
  return function (input, start, end) {
    if(input[start] < low || input[start] > high)
      return
    if(!rule)
      return {length: 1, group:[sym || input[start]]}
    var m = rule(input, start+1, end)
    if(!m) throw new Error('expected match after instruction')
    return {length: 1 + m.length, group: [sym || input[start]].concat(m.group)}
  }
}
/* instructions

there are a lot but only a few patterns

0x00 unreachable
0x01 noop
0x02 block...
0x03 loop...
0x04 if...
0x05 else...
...
0x0C br
0x0D br_if.
0x0E br_table...
0x0F return

0x10 call.
0x11 call_indirect...
...
0x1A drop
0x1B select
...
0x20-0x24 locals and globals..
...
0x28-0x3E load and store..
0x3F memory.size..
0x40 memory.grow..
0x41-0xBF single byte operators
0xFC 0x00-0x07 trunc..

0xC0-0xC4 extend

*/

var Const = OR(
  AND(Byte(0x41, Symbol('const.i32')), Varint),
  AND(Byte(0x42, Symbol('const.i64')), Varint),
  AND(Byte(0x43, Symbol('const.f32')), Varint),
  AND(Byte(0x44, Symbol('const.f64')), Varint)
)

var End = Byte(0x0b, Symbol('end'))

//var Instruction = OR(
//  Range(0x00, 0x00, null, Symbol('unreachable'))
//  Range(0x01, 0x01, null, Symbol('nop'))
//  Range(0x41, 0x44, Varint, Symbol('const'))
//)

function Rest (input, start, end) {
  return {length: end - start, groups: [input.slice(start, end)]}
}

var CodeSection =
  GROUP(AND(Byte(10, Symbol('code')),
    LengthDelimited(CountDelimited(LengthDelimited(
        GROUP(AND(
          CountDelimited( AND(Varint, ValType) ),
          Rest
        ))
    )))

      //AND(Varint, MANY(Bytes()))
    //AND(Varint, Many(Bytes())))
//    AND( Vector( AND(Varint, ValType), Symbol('locals') ), Bytes() )
  ))

var Expr = AND(Const, End)
var Mut = OR(Byte(0, Symbol('mut')), Byte(1, Symbol('imut')))

var Index = OR(
      AND(Byte(0, Symbol('func')),   Varint),
      AND(Byte(1, Symbol('table')),  Varint),
      AND(Byte(2, Symbol('memory')), Varint),
      AND(Byte(3, Symbol('global')), Varint)
    )

var Sections = GROUP(OR(
  AND(Byte( 0, Symbol('custom')), Bytes()),
  AND(Byte( 1, Symbol('type')),
    Bound(AND(Byte(0x60, Symbol('func')), Params, Result))
  ),
  AND(Byte( 2, Symbol('import')), Bound(AND(Name, Name, Index))),
  AND(Byte( 3, Symbol('function')),
    LengthDelimited(CountDelimited(Varint))),
  AND(Byte( 4, Symbol('table')), Bytes()),
  AND(Byte( 5, Symbol('memory')), Bytes()),
  AND(Byte( 6, Symbol('global')),
    Bound(AND(ValType, Mut, GROUP(Expr)))
  ),
  AND(Byte( 7, Symbol('export')), Bound(AND(Name, Index))),
  AND(Byte( 8, Symbol('start')), Bytes()),
  AND(Byte( 9, Symbol('element')), Bytes()),
  CodeSection,
  AND(Byte(11, Symbol('data')), Bound(
    AND(Expr, Bytes())
  ))
))
var limits = Symbol('limits')
var Limits = GROUP(OR(
    AND(Byte(0, limits), Varint),
    AND(Byte(1, limits), Varint, Varint)
  ))

var magic = BUFFER(Buffer.from('\x00asm'))
var version = UIntLE(1)

var wasm = AND(magic, version, GROUP(MANY(Sections)) )

module.exports = function (buffer) {
  return wasm(buffer, 0)
}

var types = Buffer.from('05 60 03 7f 7f 7f 01 7f 60 01 7f 01 7f 60 05 7f 7f 7f 7f 7f 01 7f 60 02 7f 7f 01 7f 60 00 01 7f05 60 03 7f 7f 7f 01 7f 60 01 7f 01 7f 60 05 7f 7f 7f 7f 7f 01 7f 60 02 7f 7f 01 7f 60 00 01 7f', 'hex')


if(!module.parent)
  console.log(
    require('util').inspect(
      module.exports(require('fs').readFileSync(process.argv[2])),
      {depth: 10, colors: true}
    )
  )
