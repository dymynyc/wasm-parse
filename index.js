
var {AND,OR,GROUP,MANY,MORE,RECURSE,MAYBE} = require('stack-expression')
var {ValType, Expr, Instructions} = require('./instructions')
var {
  Bound, LengthDelimited, CountDelimited, Varint, Byte, Bytes, Name
} = require('./util')

function BUFFER(b) {
  return function (input, start) {
    if(b.compare(input, start, b.length) === 0)
      return {length: b.length, groups: []}
  }
}


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
function Rest (input, start, end) {
  return {length: end - start, groups: [input.slice(start, end)]}
}

var CodeSection =
  AND(Byte(10, Symbol('code')),
    //not sure why Bound isn't working here?
    //Bound(
    LengthDelimited(CountDelimited(
        LengthDelimited(AND(
          CountDelimited( AND(Varint, ValType) ),
          MANY(Instructions)))
    ))
  )

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
  return wasm(buffer, 0, buffer.length).groups[0]
}

if(!module.parent) {
  var ast = module.exports(require('fs').readFileSync(process.argv[2]))
  var {inspect} = require('util')
  console.log(inspect(ast, {depth: Infinity, colors: process.stdout.isTTY ? true : false}))
}
