var {AND,OR,GROUP,MANY,MORE,RECURSE,MAYBE,LOG} = require('stack-expression')
var {
  CountDelimited, Varint, Byte,
} = require('./util')

var i32 = Symbol('i32'), i64 = Symbol('i64')
var f32 = Symbol('i32'), f64 = Symbol('f64')
var ValType = OR(
  Byte(0x7F, i32),
  Byte(0x7E, i64),
  Byte(0x7D, f32),
  Byte(0x7C, f64)
)


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

var symbols = {}, codes = {}

function S(sym, byte) {
  sym = symbols[sym] || (symbols[sym] = Symbol(sym))
  codes[byte] = sym
  return Byte(byte, sym)
}
function M(sym, byte, rule) {
  return GROUP(AND(S(sym, byte), rule))
}
function MM(ary, fn) {
  if(ary.every(Array.isArray))
    ary = ary.reduce((a,b) => a.concat(b))
  return OR.apply(null, ary.map(fn))
}

function X(a, b) {
  var out = []
  a = a.split(',')
  b = b.split(',')
  b.forEach(u => a.forEach(v => out.push(u+'.'+v)))
  return out
}
var BlockType = OR(Byte(0x40), ValType, Varint)
//^^ should be a signed varint. this will parse and acid lisp
//   isn't using this feature yet...

var Instructions = RECURSE()

//separate Const, because they are used elsewhere
var Const = OR(
  M('i32.const',     0x41, Varint),
  M('i64.const',     0x42, Varint),
  M('f32.const',     0x43, Varint),
  M('f64.const',     0x44, Varint)
)

var Else = S('else', 0x05)
var End =  S('end',  0x0B)

var Zero = Byte(0)

//separate blocks, because they are recursive
var Block = OR(
  M('block',         0x02, AND(BlockType, MANY(Instructions), End)),
  M('loop',          0x03, AND(BlockType, MANY(Instructions), End)),
  M('if',            0x04, AND(BlockType, MANY(Instructions),
                             MAYBE(AND(Else,  MANY(Instructions))), End))
)

var Control = OR(
  S('unreachable',   0x00),
  S('nop',           0x01),
  M('br',            0x0C, Varint),
  M('br_if',         0x0D, Varint),
  M('br_table',      0x0D, AND(CountDelimited(Varint), Varint)),
  S('return',        0x0F),
  M('call',          0x10, Varint),
  M('call_indirect', 0x11, AND(Varint, Zero)),
  S('drop',          0x1A),
  S('select',        0x1B)
)
var Vars = OR(
  M('local.get',     0x20, Varint),
  M('local.set',     0x21, Varint),
  M('local.tee',     0x22, Varint),
  M('global.get',    0x23, Varint),
  M('global.set',    0x24, Varint)
)
var Memory = OR(MM([
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
  M('memory.grow',   0x40, Zero)
)

//every single byte numeric operator
var Numeric = OR(
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

  //extend takes a signed int,
  //and makes a wider int with the same sign.
  S('i32.extend8_s',       0xC0),
  S('i32.extend16_s',      0xC1),
  S('i64.extend8_s',       0xC2),
  S('i64.extend16_s',      0xC3),
  S('i64.extend32_s',      0xC4)
)

//two byte saturated truncate (not sure what does)
var TruncSat =
  MM(X(
    'trunc_f32_s,trunc_f32_u,trunc_f64_s,trunc_f64_u',
    'i32,i64'
  ),(k,i) => M(k,          0xFC, Byte(i)))


var Instruction = OR(
  Control, Block, Const, Vars, Memory, Numeric, TruncSat
)

Instructions(MORE(OR(Instruction, Block)))

var Expr = AND(Const, End)

module.exports = {
  ValType, Instructions: AND(Instructions, End), Expr, Instruction,
  Control, Block, Const, Vars, Memory, Numeric,
  symbols, codes
}
