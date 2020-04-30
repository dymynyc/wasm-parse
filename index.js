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
dots... mean this instruction takes one or more arguments.

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

function S(sym, byte) {
  return Byte(byte, Symbol(sym)),
}
function M(sym, byte, rule) {
  return AND(Byte(byte, Symbol(sym)), rule)
}

function MM(ary, fn) {
  return OR.apply(null, ary.reduce((a,b) => a.concat(b)).map(fn)))
}
function X(a, b) {
  var out = []
  a = a.split(',')
  b = b.split(',')
  a.forEach(u => b.forEach(v => out.push(u+'.'+v)))
  return out
}
var BlockType = OR(Byte(40), ValType, Varint)
//^^ should be a signed varint. this will parse and acid lisp
//   isn't using this feature yet...

var Const = OR(
  M('i32.const',     0x41, Varint),
  M('i64.const',     0x42, Varint),
  M('f32.const',     0x43, Varint),
  M('f64.const',     0x44, Varint)
)

var End = S('end',   0x0B), Zero = Byte(0)

var Instruction = OR(
  S('unreachable',   0x00),
  S('nop',           0x01),
  M('block',         0x02, AND(BlockType, Many(Instruction), End),
  M('loop',          0x03, AND(BlockType, Many(Instruction), End),
  M('if',            0x04, AND(BlockType, Many(Instruction),
                             MAYBE(Else, Many(Instruction)), End),
  M('br',            0x0C, Varint),
  M('br_if',         0x0D, Varint),
  M('br_table',      0x0D, AND(CountDelimited(Varint), Varint),
  S('return',        0x0F),
  M('call',          0x10, Varint),
  M('call_indirect', 0x11, AND(Varint, Zero)),
  S('drop',          0x1A),
  S('select',        0x1B),
  M('local.get',     0x20, Varint),
  M('local.set',     0x21, Varint),
  M('local.tee',     0x22, Varint),
  M('global.get',    0x23, Varint),
  M('global.set',    0x24, Varint),
  MM([
    'i32.load',
    'i64.load',
    'f32.load',
    'f64.load',
    'i32.load8_s',
    'i32.load8_u',
    'i32.load16_s',
    'i32.load16_u',
    'i64.load8_s',
    'i64.load8_u',
    'i64.load16_s',
    'i64.load16_u',
    'i64.load32_s',
    'i64.load32_u',
    'i32.store',
    'i64.store',
    'f32.store',
    'f64.store',
    'i32.store8',
    'i32.store16',
    'i64.store8',
    'i64.store16',
    'i64.store32'
  ],  (k, i) => M(k, 0x28+i, AND(Varint, Varint))),
  M('memory.size',   0x3F, Zero),
  M('memory.grow',   0x40, Zero),
  MM([ X(
    'eqz,eq,ne,lt_s,lt_u,gt_s,gt_u,le_s,le_u,ge_s,ge_u', 'i32,i64'
    ), X(
    'eq,ne,lt,gt,le,ge', 'f32,f64'
    ), X(
      'clz,ctz,popcnt,add,sub,mul,div_s,div_u,rem_s,rem_u,'+
        'and,or,xor,shl,shr_s,shr_u,rotl,rotr',
      'i32,i64'
    ), X(
      'abs,neg,ceil,floor,trunc,nearest,sqrt,'+
        'add,sub,mul,div,min,max,copysign',
      'f32,f64'
    )], (k, i)=>S(k, 0x45+i)),

  S('i32.wrap_i64',        0xA7),
  S('i32.trunc_f32_s',     0xA8),
  S('i32.trunc_f32_u',     0xA9),
  S('i32.trunc_f64_s',     0xAA),
  S('i32.trunc_f64_u',     0xAB),
  S('i64.extend_i32_s',    0xAC),
  S('i64.extend_i32_u',    0xAD),
  S('i64.trunc_f32_s',     0xAE),
  S('i64.trunc_f32_u',     0xAF),
  S('i64.trunc_f64_s',     0xB0),
  S('i64.trunc_f64_u',     0xB1),
  S('f32.convert_i32_s',   0xB2),
  S('f32.convert_i32_u',   0xB3),
  S('f32.convert_i64_s',   0xB4),
  S('f32.convert_i64_u',   0xB5),
  S('f32.demote_f64',      0xB6),
  S('f64.convert_i32_s',   0xB7),
  S('f64.convert_i32_u',   0xB8),
  S('f64.convert_i64_s',   0xB9),
  S('f64.convert_i64_u',   0xBA),
  S('f64.promote_f32',     0xBB),

  S('i32.reinterpret_f32', 0xBC),
  S('i64.reinterpret_f64', 0xBD),
  S('f32.reinterpret_i32', 0xBE),
  S('f64.reinterpret_i64', 0xBF),

  MM(X(
    'trunc_f32_s,trunc_f32_u,trunc_f64_s,trunc_f64_u',
    'i32,i64'
  ),(k,i) => M(k,          0xFC, Byte(i))),

  //extend takes a signed int,
  //and makes a wider int with the same sign.
  S('i32.extend8_s',       0xC0),
  S('i32.extend16_s',      0xC1),
  S('i64.extend8_s',       0xC2),
  S('i64.extend16_s',      0xC3),
  S('i64.extend32_s',      0xC4)
)

//var Instruction = OR(
//  Range(0x00, 0x00, null, Symbol('unreachable'))
//  Range(0x01, 0x01, null, Symbol('nop'))
//  Range(0x41, 0x44, Varint, Symbol('const'))
//)

function Rest (input, start, end) {
  return {length: end - start, groups: [input.slice(start, end)]}
}

var CodeSection =
  AND(Byte(10, Symbol('code')),
    //Bound(
    LengthDelimited(CountDelimited(
        LengthDelimited(AND(
          CountDelimited( AND(Varint, ValType) ),
          Rest))
    ))
  )

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

var magic_version = BUFFER(Buffer.from('\x00asm\x01\x00\x00\x00'))

var wasm = AND(magic_version, GROUP(MANY(Sections)) )

module.exports = function (buffer) {
  return wasm(buffer, 0)
}

if(!module.parent) {
  var ast = module.exports(require('fs').readFileSync(process.argv[2])).groups[0]
  var {inspect} = require('util')
  console.log(inspect(ast, {depth: 10, colors: true}))
  console.log(ast[6][1][0].map((v, i) => 'a['+i+']="'+v[0][0][1].toString('hex')+'";').join('\n'))
}
