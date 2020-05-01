var tape = require('tape')
var a = []
a[0]="410028020021014100200146044041042201210205410021020b200120006a2103410020033602002003240020010b";
a[1]="4100200046044041a70121010541002102200041004804402000417f6c210305200021030b2003220521042004210620004100460440410122022101050340410020064704402006410a6d2106410120026a220221010c010b0b0b200041004804404101210305410021030b200220036a210420042107410420076a1002210820082007360200200821094100210a20004100480440412d210b4104200941006a6a200b3a0000200b210105410021010b0340200a20024804402005410a6f210c2005410a6d21054130200c6a210b410420092007200a41016a6b6a6a200b3a00004101200a6a220a21010c010b0b200921010b20010b";
a[2]="4100210503402005200248044041042000200120056a6a6a2d0000210641042003200420056a6a6a20063a0000200541016a220521070c010b0b41000b";
a[3]="410028020021014100200146044041042201210205410021020b200120006a2103410020033602002003240020010b";
a[4]="4104200028020020012802006a6a10052102200028020020012802006a210320022003360200200221042000410020002802002004410010041a2001410020012802002004200028020010041a20040b";
a[5]="41ca0128020020016a210241ca012002360200200020016a21030340200020034c044020002d000021042004410a46044041ce0128020041016a210241ce0120023602004101210241d601200236020020022205210505200441204604404101210241d601200236020020022205210505410041d60128020047044041d20128020041016a210241d20120023602004100210241d6012002360200200222052105054100220521050b0b0b200041016a220021050c010b0b20050b";
a[6]="4101210041d6012000360200410041da0141800810010b";
a[7]="200104404102410441fd006a4107100021020541ce012802001003418801100641d2012802001003418d01100641ca01280200100341920110061006100621034101200341046a2003280200100021020b20020b";
a[8]="2001200210071a0340410041da0141800810012202044020012002100721030c010b0b20030b";

a = a.map(e => Buffer.from(e, 'hex'))

var {Instructions, symbols, codes} = require('../instructions')


function test(input, output) {
  tape('parse:'+input, function (t) {
    var b = Buffer.from(input+'0b', "hex")
    var m = Instructions(b, 0, b.length)
    t.deepEqual(m.groups, output)
    t.end()
  })
}
console.log(symbols)
test('000b', [symbols.unreachable, symbols.end])
test('010b', [symbols.nop, symbols.end])
test('024041000b', [[symbols.block, [symbols['i32.const'], 0], symbols.end], symbols.end]) //(block (i32.const 0))
test('2802000b', [[symbols['i32.load'], 2, 0], symbols.end])
test('41002802000b', [[symbols['i32.const'], 0], [symbols['i32.load'], 2, 0], symbols.end])

a.forEach(function (v, i) {
  tape('parse fun:'+i, function (t) {
    var m = Instructions(v, 0, v.length)
    t.equal(m.length, v.length)
    console.log(m.groups)
    t.end()
  })
})
