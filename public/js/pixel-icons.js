// pixel-icons.js -- GENERIC: every emoji of the site is shown as pixel art.
//
// The site's texts keep their emojis (servers, games and data files are
// unchanged); this script swaps each known emoji on the page for a small
// pixel-art image, automatically, including content that appears later
// (a MutationObserver = "tell me when the page changes").
//   - Unknown emojis are left as they are.
//   - Text you type (inputs) is never touched.
//   - Add an icon: draw a 12x12 grid in ICONS below and list its emojis.
//   - PixelIcons.html("🔥") gives the <img> HTML directly if a page needs it.
window.PixelIcons = (function () {
  const DATA = {"pal":{"K":"#0b0618","W":"#f3e9ff","Y":"#ffd54a","O":"#ff9a3c","R":"#ff4d5e","P":"#ff2fb0","C":"#22e0ff","V":"#9b5cff","G":"#5ccf6e","B":"#3b6bff","g":"#a9a3c2","D":"#4a4266","S":"#f2c9a0","N":"#8a5636"},"icons":{"joy":{"e":["😂"],"r":["...KKKKKK...","..KYYYYYYK..",".KYYYYYYYYK.","KYYYYYYYYYYK","KYYKYYYYKYYK","KYKYKYYKYKYK","KYYYYYYYYYYK","KYKKKKKKKKYK","CYKWWWWWWKYC","CCYKRRRRKYCC","..KYYYYYYK..","...KKKKKK..."]},"hearteyes":{"e":["😍"],"r":["...KKKKKK...","..KYYYYYYK..",".KYYYYYYYYK.","KYRRYYYYRRYK","KRRRRYYRRRRK","KYRRYYYYRRYK","KYYYYYYYYYYK","KYKYYYYYYKYK","KYYKKKKKKYYK",".KYYYYYYYYK.","..KYYYYYYK..","...KKKKKK..."]},"mindblown":{"e":["🤯"],"r":[".O..O..O..O.","..OYOOYOOO..",".O.OYYYYO.O.","KKKKKKKKKKKK","KYYYYYYYYYYK","KYKKYYYYKKYK","KYYYYYYYYYYK","KYYYYKKYYYYK","KYYYYKKYYYYK",".KYYYYYYYYK.","..KYYYYYYK..","...KKKKKK..."]},"yawn":{"e":["🥱"],"r":["...KKKKKK...","..KYYYYYYK..",".KYYYYYYYYK.","KYYYYYYYYYYK","KYKKYYYYKKYK","KYYYYYYYYYYK","KYYYYKKYYYYK","KYYYKRRKYYYK","KYYYKRRKYYSS",".KYYYKKYYSSS","..KYYYYYYK..","...KKKKKK..."]},"vomit":{"e":["🤮"],"r":["...KKKKKK...","..KYYYYYYK..",".KYYYYYYYYK.","KYYYYYYYYYYK","KYKYYYYYYKYK","KYYKYYYYKYYK","KYYYYYYYYYYK","KYYYKKKKYYYK","KYYYGGGGYYYK",".KYGGGGGGYK.","..GGGGGGGG..","..GGGGGGGG.."]},"confounded":{"e":["😖"],"r":["...KKKKKK...","..KYYYYYYK..",".KYYYYYYYYK.","KYKYKYYKYKYK","KYYKYYYYKYYK","KYKYKYYKYKYK","KYYYYYYYYYYK","KYKKYKKYKKYK","KYYKKYKKYYYK",".KYYYYYYYYK.","..KYYYYYYK..","...KKKKKK..."]},"shush":{"e":["🤫"],"r":["...KKKKKK...","..KYYYYYYK..",".KYYYYYYYYK.","KYYYYYYYYYYK","KYYKYYYYKYYK","KYYYYYYYYYYK","KYYYYSSYYYYK","KYYYKKKKYYYK","KYYYYSSYYYYK",".KYYYSSYYYK.","..KYYSSYYK..","...KKKKKK..."]},"skull":{"e":["💀"],"r":["...WWWWWW...","..WWWWWWWW..",".WWWWWWWWWW.",".WKKWWWWKKW.",".WKKWWWWKKW.",".WWWWWWWWWW.","..WWWKKWWW..","..WWWWWWWW..","...WKWKWKW..","...WWWWWWW..","....KWKWK...","............"]},"fire":{"e":["🔥"],"r":[".....R......","....RR...R..","....ROR..R..","...ROOR.RR..","..RROOORRR..","..ROOYOORR..",".RROYYYORR..",".ROOYYYYOR..",".ROYYWYYOR..",".ROOYYYYOR..","..RROOOORR..","...RRRRRR..."]},"sparkles":{"e":["✨"],"r":[".....Y......",".....Y......","....YWY.....","YYYYWWWYYYY.","....YWY...Y.",".....Y...YWY",".....Y....Y.","..Y.........",".YWY....Y...","..Y....YWY..","........Y...","............"]},"party":{"e":["🎉"],"r":["........P..C","..Y...C.....",".....P..Y...","...K.....P..","..KYK.C.....","..KYPK...Y..",".KYPYCK.....",".KPYCYPK..C.","KYCYPYCYK...","KPYCYPKKK...","KKKKKK......","............"]},"eye":{"e":["👁"],"r":["............","............","...KKKKKK...","..KWWWWWWK..",".KWWWCCWWWK.","KWWWCKKCWWWK","KWWWCKKCWWWK",".KWWWCCWWWK.","..KWWWWWWK..","...KKKKKK...","............","............"]},"eyes":{"e":["👀"],"r":["............","..KKK..KKK..",".KWWWKKWWWK.",".KWWWKKWWWK.",".KWKKKKWKKK.",".KWKKKKWKKK.",".KWWWKKWWWK.",".KWWWKKWWWK.","..KKK..KKK..","............","............","............"]},"thumbup":{"e":["👍"],"r":[".....KK.....","....KSSK....","....KSSK....","...KSSSK....","KKKKSSSKKKK.","KBBKSSSSSSSK","KBBKSSSSSKK.","KBBKSSSSSSSK","KBBKSSSSSKK.","KBBKSSSSSSK.","KKKKKKKKKK..","............"]},"thumbdown":{"e":["👎"],"r":["............","..KKKKKKKKKK",".KSSSSSSKBBK","KSSSSSSSKBBK",".KKSSSSSKBBK","KSSSSSSSKBBK",".KKSSSSSKBBK",".KKKKSSSKKKK","....KSSSK...","....KSSK....","....KSSK....",".....KK....."]},"clap":{"e":["👏"],"r":["..Y.....Y...","...Y...Y....","............","...KK..KK...","..KSSKKSSK..","..KSSKKSSK..",".KSSSKKSSSK.",".KSSSSSSSSK.",".KSSSSSSSSK.","..KSSSSSSK..","...KSSSSK...","....KKKK...."]},"wave":{"e":["👋"],"r":[".Y..........","..Y..KK.KK..","....KSSKSSK.","...KKSSKSSK.","..KSKSSKSSK.","..KSSSSSSSK.","..KSSSSSSSK.","...KSSSSSSK.","....KSSSSK..",".....KSSK.Y.","......KK..Y.","............"]},"heart":{"e":["💖","❤"],"r":["............",".KKK...KKK..","KPPPK.KPPPK.","KPWPPKPPPPPK","KPPPPPPPPPPK","KPPPPPPPPPPK",".KPPPPPPPPK.","..KPPPPPPK..","...KPPPPK...","....KPPK....",".....KK.....","............"]},"bubble":{"e":["💬"],"r":["............",".KKKKKKKKKK.","KWWWWWWWWWWK","KWWWWWWWWWWK","KWKKWWKKWKKK","KWWWWWWWWWWK","KWWWWWWWWWWK",".KKKKWWKKKK.","....KWK.....","....KK......","............","............"]},"robot":{"e":["🤖"],"r":[".....YY.....",".....KK.....","..KKKKKKKK..",".KggggggggK.",".KgCCggCCgK.","KKgCCggCCgKK","KKggggggggKK",".KgKKKKKKgK.",".KggggggggK.","..KKKKKKKK..","...KgK.KgK..","...KKK.KKK.."]},"times":{"e":["✖"],"r":["............",".KK......KK.",".KRK....KRK.","..KRK..KRK..","...KRKKRK...","....KRRK....","....KRRK....","...KRKKRK...","..KRK..KRK..",".KRK....KRK.",".KK......KK.","............"]},"cross":{"e":["❌"],"r":["............",".RR......RR.",".RRR....RRR.","..RRR..RRR..","...RRRRRR...","....RRRR....","....RRRR....","...RRRRRR...","..RRR..RRR..",".RRR....RRR.",".RR......RR.","............"]},"check":{"e":["✅"],"r":["KKKKKKKKKKKK","KGGGGGGGGGGK","KGGGGGGGGWGK","KGGGGGGGWWGK","KGGGGGGWWGGK","KGWGGGWWGGGK","KGWWGWWGGGGK","KGGWWWGGGGGK","KGGGWGGGGGGK","KGGGGGGGGGGK","KGGGGGGGGGGK","KKKKKKKKKKKK"]},"forbidden":{"e":["🚫"],"r":["...RRRRRR...","..RR....RR..",".RRR.....RR.","RR.RR.....RR","R...RR.....R","R....RR....R","R.....RR...R","R......RR..R","RR......RR.R",".RR.....RRR.","..RR....RR..","...RRRRRR..."]},"bolt":{"e":["⚡"],"r":[".......KKK..","......KYYK..",".....KYYK...","....KYYK....","...KYYYKKK..","..KYYYYYYK..","..KKKYYYK...","....KYYK....","...KYYK.....","..KYYK......","..KYK.......","..KK........"]},"bulb":{"e":["💡"],"r":["....KKKK....","...KYYYYK...","..KYYWYYYK..","..KYWYYYYK..","..KYYYYYYK..","..KYYYYYYK..","...KYYYYK...","....KYYK....","....KggK....","....KggK....",".....KK.....","............"]},"lock":{"e":["🔒"],"r":["....KKKK....","...KggggK...","..Kg....gK..","..Kg....gK..","..Kg....gK..",".KKKKKKKKKK.",".KYYYYYYYYK.",".KYYYKKYYYK.",".KYYYKKYYYK.",".KYYYYKYYYK.",".KYYYYYYYYK.",".KKKKKKKKKK."]},"coin":{"e":["🪙"],"r":["...KKKKKK...","..KYYYYYYK..",".KYYOOOOYYK.","KYYOYYYYOYYK","KYOYYKKYYOYK","KYOYYKYYYOYK","KYOYYKYYYOYK","KYOYYKKYYOYK","KYYOYYYYOYYK",".KYYOOOOYYK.","..KYYYYYYK..","...KKKKKK..."]},"trophy":{"e":["🏆"],"r":[".KKKKKKKKKK.","KYKYYYYYYKYK","KYKYYWYYYKYK",".KKYYWYYYKK.","..KYYYYYYK..","...KYYYYK...","....KYYK....",".....KK.....","....KYYK....","...KKKKKK...","...KOOOOK...","...KKKKKK..."]},"speaker":{"e":["🔊","🔉"],"r":["......K.....",".....KK...C.","....KgK..C..","KKKKggK.C...","KggggggK..C.","KggggggK..C.","KggggggK..C.","KKKKggK.C...","....KgK..C..",".....KK...C.","......K.....","............"]},"mute":{"e":["🔇"],"r":["......K.....",".....KK.....","....KgK.....","KKKKggK.R..R","KggggggK.RR.","KggggggK.RR.","KggggggK.RR.","KKKKggK.R..R","....KgK.....",".....KK.....","......K.....","............"]},"cycle":{"e":["🔄","🔁","🔀"],"r":["............","...CCCCCC...","..C......C..",".C.......CC.",".C......CCCC",".C..........","..........C.","CCCC......C.",".CC.......C.","..C......C..","...CCCCCC...","............"]},"swirl":{"e":["🌀"],"r":["...CCCCCC...","..C......C..",".C..CCCC..C.","C..C....C..C","C.C..CC..C.C","C.C.C..C.C.C","C.C.C.CC.C.C","C.C..C...C.C","C..C....C..C",".C..CCCC..C.","..C.......C.","...CCCCCCC.."]},"die":{"e":["🎲"],"r":["KKKKKKKKKKKK","KWWWWWWWWWWK","KWRRWWWWRRWK","KWRRWWWWRRWK","KWWWWWWWWWWK","KWWWWRRWWWWK","KWWWWRRWWWWK","KWWWWWWWWWWK","KWRRWWWWRRWK","KWRRWWWWRRWK","KWWWWWWWWWWK","KKKKKKKKKKKK"]},"next":{"e":["⏭"],"r":["............","............",".C...C...CC.",".CC..CC..CC.",".CCC.CCC.CC.",".CCCCCCCCCC.",".CCCCCCCCCC.",".CCC.CCC.CC.",".CC..CC..CC.",".C...C...CC.","............","............"]},"ffwd":{"e":["⏩"],"r":["............","............",".C....C.....",".CC...CC....",".CCC..CCC...",".CCCC.CCCC..",".CCCC.CCCC..",".CCC..CCC...",".CC...CC....",".C....C.....","............","............"]},"stopwatch":{"e":["⏱","🕘"],"r":["....KKKK....",".....KK..K..","...KKKKKKK..","..KWWWWWWK..",".KWWWWKWWWK.",".KWWWWKWWWK.",".KWWWWKWWWK.",".KWWWKKKKWK.",".KWWWWWWWWK.","..KWWWWWWK..","...KKKKKK...","............"]},"ghost":{"e":["👻"],"r":["...KKKKKK...","..KWWWWWWK..",".KWWWWWWWWK.",".KWKKWWKKWK.",".KWKKWWKKWK.",".KWWWWWWWWK.",".KWWWKKWWWK.",".KWWWKKWWWK.",".KWWWWWWWWK.",".KWWWWWWWWK.",".KWKWWKKWWK.",".KK.KK..KKK."]},"monitor":{"e":["🖥"],"r":["KKKKKKKKKKKK","KCCCCCCCCCCK","KCWCCCCCCCCK","KCCCCCCCCCCK","KCCCCCCCCCCK","KCCCCCCCCCCK","KCCCCCCCCCCK","KKKKKKKKKKKK",".....KK.....",".....KK.....","...KKKKKK...","............"]},"clipboard":{"e":["📋"],"r":["....KKKK....",".KKKggggKKK.",".KNNKKKKNNK.",".KNWWWWWWNK.",".KNWKKKKWNK.",".KNWWWWWWNK.",".KNWKKKKWNK.",".KNWWWWWWNK.",".KNWKKKWWNK.",".KNWWWWWWNK.",".KNNNNNNNNK.",".KKKKKKKKKK."]},"knobs":{"e":["🎛"],"r":["KKKKKKKKKKKK","KDDDDDDDDDDK","KDCCDDDPPDDK","KDCKCDDPKPDK","KDCCDDDPPDDK","KDDDDDDDDDDK","KDYDDYDDYDDK","KDYDDYDDYDDK","KDKDDYDDKDDK","KDYDDKDDYDDK","KDDDDDDDDDDK","KKKKKKKKKKKK"]},"ballot":{"e":["🗳"],"r":["...KKKKKK...","...KWWWWK...","...KWKKWK...","...KWWWWK...","KKKKKKKKKKKK","KBBBBBBBBBBK","KBBKKKKKKBBK","KBBBBBBBBBBK","KBBBBBBBBBBK","KBBBBBBBBBBK","KBBBBBBBBBBK","KKKKKKKKKKKK"]},"shield":{"e":["🛡"],"r":["KKKKKKKKKKKK","KBBBBBYBBBBK","KBBBBBYBBBBK","KBBBBBYBBBBK","KYYYYYYYYYYK","KBBBBBYBBBBK",".KBBBBYBBBK.",".KBBBBYBBBK.","..KBBBYBBK..","...KBBYBK...","....KBBK....",".....KK....."]},"gamepad":{"e":["🎮"],"r":["............","............","..KKKKKKKK..",".KDDDDDDDDK.","KDDKDDDDDRDK","KDKKKDDDRDGK","KDDKDDDDDBDK","KDDDDDDDDDDK","KDDDKKKKDDDK",".KDK....KDK.","..K......K..","............"]},"wrench":{"e":["🔧"],"r":[".........KK.","........Kgg.",".......Kgg.K","......KgggKg",".....KgggKgK","....KgggK.K.","...KgggK....","..KgggK.....",".KgggK......","Kgg.K.......","Kg.K........",".KK........."]},"brain":{"e":["🧠"],"r":["...KKKKKK...","..KPPKPPPK..",".KPPPKPKPPK.","KPKPPKPPKPPK","KPPKPKPKPPPK","KPPPPKPPPKPK","KPKPPKPPKPPK","KPPKPKPKPPPK",".KPPPKPPPPK.","..KPPKPPPK..","...KKKKKKK..","............"]},"trap":{"e":["🪤"],"r":["............","............","............","....gggg....","...g....g...","...g....g...","..YYYYYYYY..","..gYYYYYYg..",".KKKKKKKKKK.",".KNNNNNNNNK.",".KKKKKKKKKK.","............"]},"magnifier":{"e":["🔍"],"r":["..KKKK......",".KCCCCK.....","KCWCCCCK....","KCWCCCCK....","KCCCCCCK....","KCCCCCCK....",".KCCCCKK....","..KKKKNNK...","......KNNK..",".......KNNK.","........KNNK",".........KK."]},"book":{"e":["📖"],"r":["............","............",".KKKK..KKKK.","KWWWWKKWWWWK","KWKKWKKWKKWK","KWWWWKKWWWWK","KWKKWKKWKKWK","KWWWWKKWWWWK","KWKKWKKWKKWK","KWWWWKKWWWWK",".KKKKKKKKKK.","............"]},"sheep":{"e":["🐑"],"r":["............","..WWWWWWW...",".WWWWWWWWWKK","WWWWWWWWWKgK","WWWWWWWWWKKK","WWWWWWWWWWK.",".WWWWWWWWW..","..K.K..K.K..","..K.K..K.K..","............","............","............"]},"lizard":{"e":["🦎"],"r":["............",".........GG.","........GKGG",".......GGGG.","..GG..GGGG..",".GGGGGGGG...",".G.GGGGGG...","...GGGGGGG..","..GG..G..G..",".G...GG.....","G....G......","............"]},"bomb":{"e":["💣"],"r":[".......Y.O..","........Y...",".......KN...","......KK....","...KKKKKK...","..KDDDDDDK..",".KDWDDDDDDK.",".KDWDDDDDDK.",".KDDDDDDDDK.",".KDDDDDDDDK.","..KDDDDDDK..","...KKKKKK..."]},"target":{"e":["🎯"],"r":["...RRRRRR...","..RWWWWWWR..",".RWRRRRRRWR.","RWRWWWWWWRWR","RWRWRRRRWRWR","RWRWRKKRWRWR","RWRWRKKRWRWR","RWRWRRRRWRWR","RWRWWWWWWRWR",".RWRRRRRRWR.","..RWWWWWWR..","...RRRRRR..."]},"disc":{"e":["💿"],"r":["...KKKKKK...","..KggggggK..",".KgWggggCgK.","KgWgggggCggK","KgggKKKKgggK","KgggKKKKgggK","KgggKKKKgggK","KgggKKKKgggK","KggPgggggggK",".KgPgggggggK","..KggggggK..","...KKKKKK..."]},"note":{"e":["🎵","🎶"],"r":[".....KKKKKK.",".....KCCCCK.",".....KKKKKK.",".....K....K.",".....K....K.",".....K....K.",".....K....K.","..KKKK..KKKK",".KCCCK.KCCCK",".KCCCK.KCCCK","..KKK...KKK.","............"]},"signal":{"e":["📶"],"r":["............",".........CC.",".........CC.","......CC.CC.","......CC.CC.","...CC.CC.CC.","...CC.CC.CC.","CC.CC.CC.CC.","CC.CC.CC.CC.","CC.CC.CC.CC.","............","............"]},"snow":{"e":["❄"],"r":[".....C......","...C.C.C....","....CCC.....",".C...C...C..","..C..C..C...","CCCCCCCCCCC.","..C..C..C...",".C...C...C..","....CCC.....","...C.C.C....",".....C......","............"]},"gift":{"e":["🎁"],"r":["..PP...PP...","...PP.PP....","KKKKKPKKKKK.","KRRRRPRRRRK.","KKKKKPKKKKK.",".KRRRPRRRK..",".KRRRPRRRK..",".KRRRPRRRK..",".KRRRPRRRK..",".KRRRPRRRK..",".KKKKKKKKK..","............"]},"palette":{"e":["🎨"],"r":["...KKKKKK...","..KNNNNNNK..",".KNRNNNNCNK.","KNNNNNNNNNNK","KNYNNNNNNNNK","KNNNNKKNNPNK","KNNNNKKNNNNK","KNGNNNNNNNNK",".KNNNNNNBNK.","..KNNNNNNK..","...KKKKKK...","............"]},"sponge":{"e":["🧽"],"r":["............","..KKKKKKKK..",".KGGGGGGGGK.",".KGGGGGGGGK.",".KKKKKKKKKK.",".KYYOYYYOYK.",".KYYYYOYYYK.",".KOYYYYYOYK.",".KYYYOYYYYK.",".KKKKKKKKKK.","............","............"]},"monkey":{"e":["🙈"],"r":["...KKKKKK...","..KNNNNNNK..",".KNNNNNNNNK.","KNSSSNNSSSNK","KSSSSSSSSSSK","KSSKSSSSKSSK","KSSSSSSSSSSK",".KSSSSSSSSK.",".KNSSKKSSNK.",".KNNSSSSNNK.","..KNNNNNNK..","...KKKKKK..."]},"masks":{"e":["🎭"],"r":["KKKKK.......","KWWWK.KKKKK.","KWKWKKYYYYK.","KWWWKKYKYKK.","KWKKWKYYYYK.","KWWWWKYYYYK.",".KWWK.KYKKYK","..KK..KYYYYK","......KYYYK.",".......KKK..","............","............"]},"detective":{"e":["🕵"],"r":["....KKKK....","...KDDDDK...","..KDDDDDDK..",".KKKKKKKKKK.","KDDDDDDDDDDK",".KKKKKKKKKK.","..KSSSSSSK..","..KKKSSKKK..","..KCKSSKCK..","..KSSSSSSK..","...KSRRSK...","....KKKK...."]},"joker":{"e":["🃏"],"r":["KKKKKKKKKK..","KWWWWWWWWK..","KWRWWWWWWK..","KWWWPPWWWK..","KWWPYYPWWK..","KWWPYYPWWK..","KWWWPPWWWK..","KWWWWWWWWK..","KWWWWWWRWK..","KWWWWWWWWK..","KKKKKKKKKK..","............"]},"card":{"e":["🎴","🂠"],"r":[".KKKKKKKKK..",".KVVVVVVVK..",".KVCVVVCVK..",".KVVCVCVVK..",".KVVVCVVVK..",".KVVCVCVVK..",".KVCVVVCVK..",".KVVCVCVVK..",".KVVVCVVVK..",".KVVVVVVVK..",".KKKKKKKKK..","............"]},"headphones":{"e":["🎧"],"r":["...KKKKKK...","..KVVVVVVK..",".KVKKKKKKVK.",".KVK....KVK.",".KVK....KVK.","KKVKK..KKVKK","KPPPK..KPPPK","KPCPK..KPCPK","KPCPK..KPCPK","KPPPK..KPPPK",".KKK....KKK.","............"]},"pumpkin":{"e":["🎃"],"r":[".....GG.....","...KKKKKK...","..KOOOOOOK..",".KOKOOOOKOK.",".KOOOOOOOOK.","KOOKKOOKKOOK","KOOOOOOOOOOK","KOKOKOKOKOOK",".KOKKKKKKOK.","..KOOOOOOK..","...KKKKKK...","............"]},"alien":{"e":["👽"],"r":["...KKKKKK...","..KGGGGGGK..",".KGGGGGGGGK.","KGKKKGGKKKGK","KGKKKGGKKKGK","KGGKKGGKKGGK",".KGGGGGGGGK.","..KGGGGGGK..","...KGKKGK...","....KGGK....",".....KK.....","............"]},"dragon":{"e":["🐲","🐉"],"r":["..K.....K...",".KGK...KGK..",".KGGKKKGGK..",".KGGGGGGGGK.","KGGWKGGWKGK.","KGGKKGGKKGK.","KGGGGGGGGGGK","KGYYYYYYYYGK",".KGWGWGWGGK.","..KGGGGGGK..","...KKKKKK...","............"]},"flamingo":{"e":["🦩"],"r":["....KKK.....","...KPPPK....","...KPKPK....","....KPKK....",".....KPK....","....KPPPK...","...KPPPPPK..","...KPPPPK...","....KKPK....","......K.....","......K.....",".....KK....."]},"hand":{"e":["✋","☝","🖐","🤚"],"r":["...K.K.K....","..KSKSKSK...","..KSKSKSK.K.","..KSKSKSKKSK","..KSSSSSKSK.","..KSSSSSSSK.","..KSSSSSSSK.","..KSSSSSSK..","...KSSSSK...","....KKKK....","............","............"]}}};
  const PAL = DATA.pal, ICONS = DATA.icons;
  const byEmoji = {};
  Object.keys(ICONS).forEach((name) => ICONS[name].e.forEach((e) => (byEmoji[e.replace(/️/g, "")] = name)));
  const keys = Object.keys(byEmoji).sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const RE = new RegExp("(" + keys.join("|") + ")️?", "gu");
  const TEST = new RegExp("(" + keys.join("|") + ")", "u");

  const cache = {};
  function url(name) {
    if (cache[name]) return cache[name];
    const rows = ICONS[name].r, n = rows.length, sc = 4;
    const c = document.createElement("canvas"); c.width = c.height = n * sc;
    const x = c.getContext("2d");
    rows.forEach((row, y) => [...row].forEach((ch, xx) => {
      if (ch === ".") return;
      x.fillStyle = PAL[ch]; x.fillRect(xx * sc, y * sc, sc, sc);
    }));
    return (cache[name] = c.toDataURL("image/png"));
  }
  function img(emoji) {
    const name = byEmoji[emoji.replace(/️/g, "")];
    const im = document.createElement("img");
    im.className = "pxi"; im.src = url(name); im.alt = emoji; im.draggable = false;
    im.setAttribute("aria-label", emoji);
    return im;
  }
  function html(emoji) {
    const name = byEmoji[String(emoji).replace(/️/g, "")];
    return name ? `<img class="pxi" src="${url(name)}" alt="${emoji}" draggable="false">` : emoji;
  }

  const SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, OPTION: 1, TITLE: 1, NOSCRIPT: 1 };
  function skip(node) {
    for (let p = node.parentNode; p && p.nodeType === 1; p = p.parentNode) {
      if (SKIP[p.nodeName] || p.isContentEditable || (p.classList && p.classList.contains("no-pxi"))) return true;
    }
    return false;
  }
  function swapText(t) {
    const s = t.nodeValue;
    if (!s || !TEST.test(s) || skip(t)) return;
    const frag = document.createDocumentFragment();
    let last = 0;
    s.replace(RE, (m, e, i) => {
      if (i > last) frag.appendChild(document.createTextNode(s.slice(last, i)));
      frag.appendChild(img(e));
      last = i + m.length;
      return m;
    });
    if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    if (t.parentNode) t.parentNode.replaceChild(frag, t);
  }
  function scan(root) {
    if (!root) return;
    if (root.nodeType === 3) return swapText(root);
    if (root.nodeType !== 1 || SKIP[root.nodeName]) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const list = [];
    while (w.nextNode()) list.push(w.currentNode);
    list.forEach(swapText);
  }

  // Watch the page: new or changed content is converted in the next frame.
  let queue = [], queued = false;
  function flush() {
    queued = false;
    const q = queue; queue = [];
    q.forEach((n) => { if (n.isConnected) scan(n); });
  }
  function start() {
    const st = document.createElement("style");
    st.textContent = ".pxi{display:inline-block;width:1.15em;height:1.15em;vertical-align:-0.2em;image-rendering:pixelated;margin:0 .05em}";
    document.head.appendChild(st);
    scan(document.body);
    new MutationObserver((muts) => {
      muts.forEach((m) => {
        if (m.type === "characterData") queue.push(m.target);
        else m.addedNodes.forEach((n) => queue.push(n));
      });
      if (!queued && queue.length) { queued = true; requestAnimationFrame(flush); }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);

  return { html, url: (e) => { const n = byEmoji[String(e).replace(/️/g, "")]; return n ? url(n) : ""; }, scan };
})();
