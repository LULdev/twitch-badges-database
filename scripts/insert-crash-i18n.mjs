/**
 * One-off: insert the Badge Rocket i18n keys into all 11 messages files.
 * House discipline (memory: insertion-scripts-validate-before-write):
 *   - JSON.parse BEFORE any write; abort the whole run on any anomaly
 *   - round-trip check: the file must be byte-identical to
 *     JSON.stringify(parsed, null, 2) under CRLF, else abort (format drift)
 *   - anchor by key: crash keys must NOT exist yet, pingu anchors must
 *   - after writing: re-read, re-parse, assert every key landed
 *
 * Run: npx tsx scripts/insert-crash-i18n.mjs   (node works too — plain .mjs)
 */
import fs from "node:fs";

const T = {
  en: {
    crashTitle: "Badge Rocket",
    crashDesc:
      "Ride the badge rocket as the multiplier climbs — cash out before it blows and every coin is yours.",
    crashHint:
      "Launch and the multiplier climbs from 1.00× — hit Cash out before the rocket explodes. The longer you ride, the higher the payout; past 10× you reach the moon.",
    crashLaunch: "Launch",
    crashCashout: "Cash out",
    crashAgain: "Launch again",
    crashAuto: "Auto cash out",
    crashAutoOff: "Off",
    crashAutoChip: "Auto {mult}×",
    crashCrashedAt: "Crashed at {mult}×",
    crashCashedAt: "Cashed out at {mult}×",
    crashHistory: "Last flights",
    crashQ: "What is Badge Rocket and when should I cash out?",
    crashA:
      "Badge Rocket is the arcade's 15th game and its first live-interactive one. Launch the rocket and the multiplier climbs from 1.00× — hit Cash out before the rocket explodes to bank your bet times the multiplier. The crash point is rolled server-side and never leaves the server before it happens; the cash-out is graded by the server clock, and an optional auto cash-out is enforced server-side too, so closing the tab cannot cost you a banked target. A lost flight feeds the game's own pot and the Mega Jackpot like every other game, riding past 10× is called reaching the moon, and 50× earns the Escape Velocity achievement.",
    heroF3Desc:
      "15 arcade games, XP, levels, coins and 140 achievements — plus a daily Wheel of Fortune with a Twitch Turbo jackpot at real 1-in-100,000,000 odds.",
    hubSubtitle: "15 Twitch-badge games — bet BadgesCoins, win BadgesCoins, earn XP.",
    coinsA:
      "BadgesCoins are bet in all 15 arcade games, paid as attempt costs for coin heists, and earned from daily bonuses, badge unlocks, achievements and game wins.",
  },
  de: {
    crashTitle: "Badge Rocket",
    crashDesc:
      "Reite auf der Badge-Rakete, während der Multiplikator steigt — zahle aus, bevor sie explodiert, und jeder Coin gehört dir.",
    crashHint:
      "Starte, und der Multiplikator steigt ab 1,00× — drücke Auszahlen, bevor die Rakete explodiert. Je länger du an Bord bleibst, desto höher die Auszahlung; über 10× erreichst du den Mond.",
    crashLaunch: "Starten",
    crashCashout: "Auszahlen",
    crashAgain: "Erneut starten",
    crashAuto: "Auto-Auszahlung",
    crashAutoOff: "Aus",
    crashAutoChip: "Auto {mult}×",
    crashCrashedAt: "Abgestürzt bei {mult}×",
    crashCashedAt: "Ausgezahlt bei {mult}×",
    crashHistory: "Letzte Flüge",
    crashQ: "Was ist Badge Rocket und wann sollte ich auszahlen?",
    crashA:
      "Badge Rocket ist das 15. Spiel der Arcade und das erste mit Live-Interaktion. Starte die Rakete, und der Multiplikator steigt ab 1,00× — drücke Auszahlen, bevor die Rakete explodiert, um deinen Einsatz mal Multiplikator zu kassieren. Der Absturzpunkt wird serverseitig ausgewürfelt und verlässt den Server nie, bevor es passiert; die Auszahlung wird nach der Server-Uhr bewertet, und auch eine optionale Auto-Auszahlung wird serverseitig erzwungen — deshalb kann dir das Schließen des Tabs kein gespeichertes Ziel kosten. Ein verlorener Flug speist wie in jedem anderen Spiel den Jackpot des Spiels selbst und den Mega Jackpot, über 10× hinaus zu fliegen nennt man „den Mond erreichen“, und 50× bringt den Erfolg „Escape Velocity“.",
    heroF3Desc:
      "15 Arcade-Spiele, XP, Level, Coins und 140 Erfolge — plus ein tägliches Glücksrad mit einem Twitch-Turbo-Jackpot mit echten 1-zu-100.000.000-Chancen.",
    hubSubtitle: "15 Twitch-Badge-Spiele — BadgesCoins setzen, BadgesCoins gewinnen, XP verdienen.",
    coinsA:
      "BadgesCoins werden in allen 15 Arcade-Spielen eingesetzt, als Versuchs-Kosten für BadgesCoin-Überfälle bezahlt und durch Tagesboni, Badge-Freischaltungen, Errungenschaften und Spielgewinne verdient.",
  },
  es: {
    crashTitle: "Badge Rocket",
    crashDesc:
      "Súbete al cohete de insignias mientras el multiplicador sube — retira antes de que explote y cada moneda es tuya.",
    crashHint:
      "Despega y el multiplicador sube desde 1,00× — pulsa Retirar antes de que el cohete explote. Cuanto más tiempo vueles, mayor es el pago; más allá de 10× llegas a la luna.",
    crashLaunch: "Despegar",
    crashCashout: "Retirar",
    crashAgain: "Despegar de nuevo",
    crashAuto: "Retiro automático",
    crashAutoOff: "Desactivado",
    crashAutoChip: "Auto {mult}×",
    crashCrashedAt: "Explotó en {mult}×",
    crashCashedAt: "Retirado en {mult}×",
    crashHistory: "Últimos vuelos",
    crashQ: "¿Qué es Badge Rocket y cuándo debería retirar?",
    crashA:
      "Badge Rocket es el juego número 15 del arcade y el primero con interacción en directo. Lanza el cohete y el multiplicador sube desde 1,00× — pulsa Retirar antes de que el cohete explote para llevarte tu apuesta multiplicada por el multiplicador. El punto de explosión se sortea en el servidor y nunca sale de él antes de ocurrir; el retiro se evalúa según el reloj del servidor, y un retiro automático opcional también se aplica en el servidor, así que cerrar la pestaña no puede costarte un objetivo fijado. Un vuelo perdido alimenta el bote del propio juego y el Mega Jackpot como en todos los demás juegos, volar más allá de 10× se llama llegar a la luna, y 50× otorga el logro «Escape Velocity».",
    heroF3Desc:
      "15 juegos arcade, XP, niveles, monedas y 140 logros — más una ruleta diaria con un jackpot de Twitch Turbo con probabilidades reales de 1 entre 100.000.000.",
    hubSubtitle: "15 juegos de insignias de Twitch — apuesta BadgesCoins, gana BadgesCoins, consigue XP.",
    coinsA:
      "Los BadgesCoins se apuestan en los 15 juegos arcade, se pagan como coste de intento en los robos y se ganan con bonos diarios, insignias desbloqueadas, logros y victorias.",
  },
  fr: {
    crashTitle: "Badge Rocket",
    crashDesc:
      "Chevauche la fusée à badges pendant que le multiplicateur grimpe — encaisse avant qu'elle n'explose et chaque pièce est à toi.",
    crashHint:
      "Décolle et le multiplicateur grimpe à partir de 1,00× — appuie sur Encaisser avant que la fusée n'explose. Plus tu restes en vol, plus le gain est élevé ; au-delà de 10×, tu atteins la lune.",
    crashLaunch: "Décoller",
    crashCashout: "Encaisser",
    crashAgain: "Décoller à nouveau",
    crashAuto: "Auto-encaissement",
    crashAutoOff: "Désactivé",
    crashAutoChip: "Auto {mult}×",
    crashCrashedAt: "A explosé à {mult}×",
    crashCashedAt: "Encaissé à {mult}×",
    crashHistory: "Derniers vols",
    crashQ: "Qu'est-ce que Badge Rocket et quand faut-il encaisser ?",
    crashA:
      "Badge Rocket est le 15e jeu de l'arcade et son premier jeu interactif en direct. Décolle et le multiplicateur grimpe à partir de 1,00× — appuie sur Encaisser avant que la fusée n'explose pour empocher ta mise multipliée par le multiplicateur. Le point d'explosion est tiré côté serveur et ne quitte jamais le serveur avant de se produire ; l'encaissement est jugé sur l'horloge du serveur, et un encaissement automatique optionnel est lui aussi appliqué côté serveur — fermer l'onglet ne peut donc pas te coûter un objectif sécurisé. Un vol perdu alimente le pot du jeu lui-même et le Mega Jackpot comme dans tous les autres jeux, dépasser les 10× s'appelle atteindre la lune, et 50× rapporte le succès « Escape Velocity ».",
    heroF3Desc:
      "15 jeux d'arcade, de l'XP, des niveaux, des pièces et 140 succès — plus une roue quotidienne avec un jackpot Twitch Turbo à de vraies chances de 1 sur 100 000 000.",
    hubSubtitle: "15 jeux de badges Twitch — misez des BadgesCoins, gagnez des BadgesCoins, gagnez de l'XP.",
    coinsA:
      "Les BadgesCoins se misent dans les 15 jeux d'arcade, servent de coût de tentative lors des vols et s'obtiennent via les bonus quotidiens, les badges débloqués, les succès et les victoires.",
  },
  it: {
    crashTitle: "Badge Rocket",
    crashDesc:
      "Cavalca il razzo dei badge mentre il moltiplicatore sale — incassa prima che esploda e ogni moneta è tua.",
    crashHint:
      "Decolla e il moltiplicatore sale da 1,00× — premi Incassa prima che il razzo esploda. Più a lungo resti a bordo, più alta è la vincita; oltre i 10× raggiungi la luna.",
    crashLaunch: "Decolla",
    crashCashout: "Incassa",
    crashAgain: "Decolla di nuovo",
    crashAuto: "Incasso automatico",
    crashAutoOff: "Disattivato",
    crashAutoChip: "Auto {mult}×",
    crashCrashedAt: "Esploso a {mult}×",
    crashCashedAt: "Incassato a {mult}×",
    crashHistory: "Ultimi voli",
    crashQ: "Che cos'è Badge Rocket e quando conviene incassare?",
    crashA:
      "Badge Rocket è il quindicesimo gioco dell'arcade e il primo interattivo in tempo reale. Lancia il razzo e il moltiplicatore sale da 1,00× — premi Incassa prima che il razzo esploda per intascare la puntata moltiplicata per il moltiplicatore. Il punto di esplosione viene sorteggiato sul server e non lascia mai il server prima che accada; l'incasso viene valutato in base all'orologio del server, e anche un incasso automatico facoltativo viene applicato sul server, quindi chiudere la scheda non può costarti un obiettivo già salvato. Un volo perso alimenta il piatto del gioco stesso e il Mega Jackpot come in tutti gli altri giochi, volare oltre i 10× si chiama raggiungere la luna, e 50× assegna l'obiettivo «Escape Velocity».",
    heroF3Desc:
      "15 giochi arcade, XP, livelli, monete e 140 obiettivi — più una ruota quotidiana con un jackpot Twitch Turbo a probabilità reali di 1 su 100.000.000.",
    hubSubtitle: "15 giochi di badge Twitch — punta BadgesCoins, vinci BadgesCoins, guadagna XP.",
    coinsA:
      "I BadgesCoins si puntano nei 15 giochi arcade, si pagano come costo di tentativo nei furti e si ottengono con bonus giornalieri, badge sbloccati, obiettivi e vittorie.",
  },
  pt: {
    crashTitle: "Badge Rocket",
    crashDesc:
      "Voe no foguete de emblemas enquanto o multiplicador sobe — saque antes da explosão e todas as moedas são suas.",
    crashHint:
      "Lance e o multiplicador sobe a partir de 1.00× — clique em Sacar antes de o foguete explodir. Quanto mais tempo voar, maior o pagamento; acima de 10× você chega à Lua.",
    crashLaunch: "Lançar",
    crashCashout: "Sacar",
    crashAgain: "Lançar novamente",
    crashAuto: "Saque automático",
    crashAutoOff: "Desligado",
    crashAutoChip: "Auto {mult}×",
    crashCrashedAt: "Explodiu em {mult}×",
    crashCashedAt: "Sacou em {mult}×",
    crashHistory: "Últimos voos",
    crashQ: "O que é o Badge Rocket e quando devo sacar?",
    crashA:
      "O Badge Rocket é o 15º jogo do fliperama e o primeiro interativo ao vivo. Lance o foguete e o multiplicador sobe a partir de 1.00× — clique em Sacar antes de o foguete explodir para embolsar sua aposta vezes o multiplicador. O ponto de explosão é sorteado no servidor e nunca sai dele antes de acontecer; o saque é avaliado pelo relógio do servidor, e o saque automático opcional também é garantido pelo servidor — então fechar a aba não pode custar um alvo já assegurado. Um voo perdido alimenta o pote do próprio jogo e o Mega Jackpot como qualquer outro jogo, passar de 10× é chamado de chegar à Lua, e 50× rende a conquista Escape Velocity.",
    heroF3Desc:
      "15 jogos de fliperama, XP, níveis, moedas e 140 conquistas — além de uma Roda da Fortuna diária com jackpot de Twitch Turbo a chances reais de 1 em 100.000.000.",
    hubSubtitle: "15 jogos de emblemas da Twitch — aposte BadgesCoins, ganhe BadgesCoins, ganhe XP.",
    coinsA:
      "Os BadgesCoins são apostados em todos os 15 jogos arcade, pagos como custo de tentativa nos roubos e ganhos em bônus diários, emblemas desbloqueados, conquistas e vitórias.",
  },
  ru: {
    crashTitle: "Badge Rocket",
    crashDesc:
      "Летите на ракете значков, пока множитель растёт, — заберите выигрыш до взрыва, и все монеты ваши.",
    crashHint:
      "Запустите ракету, и множитель начнёт расти с 1.00× — нажмите «Забрать» до взрыва ракеты. Чем дольше полёт, тем выше выплата; после 10× вы достигаете Луны.",
    crashLaunch: "Запустить",
    crashCashout: "Забрать",
    crashAgain: "Запустить снова",
    crashAuto: "Автовывод",
    crashAutoOff: "Выкл.",
    crashAutoChip: "Авто {mult}×",
    crashCrashedAt: "Взрыв на {mult}×",
    crashCashedAt: "Забрано на {mult}×",
    crashHistory: "Последние полёты",
    crashQ: "Что такое Badge Rocket и когда забирать выигрыш?",
    crashA:
      "Badge Rocket — 15-я игра аркады и первая её интерактивная игра в реальном времени. Запустите ракету, и множитель начнёт расти с 1.00× — нажмите «Забрать» до взрыва, чтобы получить ставку, умноженную на множитель. Точка взрыва разыгрывается на сервере и не покидает его до самого события; момент выплаты определяется по часам сервера, а опциональный автовывод тоже исполняется на сервере — поэтому закрытие вкладки не отнимет уже зафиксированную цель. Проигранный полёт питает банк самой игры и Mega Jackpot, как и в любой другой игре; полёт выше 10× называется «долететь до Луны», а 50× приносит достижение Escape Velocity.",
    heroF3Desc:
      "15 аркадных игр, XP, уровни, монеты и 140 достижений — плюс ежедневное колесо фортуны с джекпотом Twitch Turbo и реальными шансами 1 к 100 000 000.",
    hubSubtitle: "15 игр с Twitch-значками — ставьте BadgesCoins, выигрывайте BadgesCoins, получайте XP.",
    coinsA:
      "BadgesCoins ставятся во всех 15 аркадных играх, оплачивают попытки ограблений и зарабатываются на ежедневных бонусах, открытых значках, достижениях и победах.",
  },
  ar: {
    crashTitle: "Badge Rocket",
    crashDesc:
      "اركب صاروخ الشارات بينما يصعد المضاعف — اسحب قبل الانفجار فتكون كل عملة لك.",
    crashHint:
      "انطلق فيبدأ المضاعف بالصعود من 1.00× — اسحب قبل أن ينفجر الصاروخ. كلما طالت الرحلة زادت المكافأة، وبعد 10× تصل إلى القمر.",
    crashLaunch: "إطلاق",
    crashCashout: "اسحب",
    crashAgain: "إطلاق مجددًا",
    crashAuto: "سحب تلقائي",
    crashAutoOff: "معطّل",
    crashAutoChip: "تلقائي {mult}×",
    crashCrashedAt: "انفجر عند {mult}×",
    crashCashedAt: "تم السحب عند {mult}×",
    crashHistory: "آخر الرحلات",
    crashQ: "ما هو Badge Rocket ومتى يجب أن تسحب؟",
    crashA:
      "Badge Rocket هو اللعبة الخامسة عشرة في الأركيد وأول لعبة تفاعلية حية فيه. أطلق الصاروخ فيبدأ المضاعف بالصعود من 1.00× — اسحب قبل أن ينفجر الصاروخ لتقبض رهانك مضروبًا في المضاعف. نقطة الانفجار تُحتسب داخل الخادم ولا تغادره أبدًا قبل وقوعها؛ والسحب يُقيَّم بساعة الخادم، والسحب التلقائي الاختياري يُنفَّذ في الخادم أيضًا، لذا فإن إغلاق التبويب لا يمكن أن يضيّع لك هدفًا مؤمَّنًا. الرحلة الخاسرة تغذي جاكبوت اللعبة نفسها بالإضافة إلى Mega Jackpot كما في كل لعبة أخرى، وتجاوز 10× يُسمى الوصول إلى القمر، و50× يمنحك إنجاز Escape Velocity.",
    heroF3Desc:
      "15 لعبة أركيد، ونقاط خبرة، ومستويات، وعملات، و140 إنجازًا — إضافة إلى عجلة الحظ اليومية بجائزة Twitch Turbo باحتمالات حقيقية 1 من 100,000,000.",
    hubSubtitle: "15 لعبة شارات Twitch — راهن بـ BadgesCoins واربح BadgesCoins واكسب XP.",
    coinsA:
      "تُستخدم BadgesCoins للمراهنة في جميع ألعاب الأركيد الـ15، وتُدفع كتكلفة محاولة في السرقات، وتُكسب من المكافآت اليومية والشارات المفتوحة والإنجازات والانتصارات.",
  },
  ja: {
    crashTitle: "Badge Rocket",
    crashDesc:
      "倍率が上がっていくバッジロケットに乗り込もう — 爆発する前にキャッシュアウトすれば、コインはすべてあなたのもの。",
    crashHint:
      "発射すると倍率は1.00×から上昇 — ロケットが爆発する前にキャッシュアウトを押そう。長く乗るほど配当が大きくなり、10×を超えれば月に到達。",
    crashLaunch: "発射",
    crashCashout: "キャッシュアウト",
    crashAgain: "もう一度発射",
    crashAuto: "自動キャッシュアウト",
    crashAutoOff: "オフ",
    crashAutoChip: "自動 {mult}×",
    crashCrashedAt: "{mult}×で爆発",
    crashCashedAt: "{mult}×でキャッシュアウト",
    crashHistory: "最近のフライト",
    crashQ: "Badge Rocketとは？いつキャッシュアウトすればいい？",
    crashA:
      "Badge Rocketはアーケード15番目のゲームで、初のライブインタラクティブゲームです。ロケットを発射すると倍率は1.00×から上昇 — 爆発する前にキャッシュアウトすれば、賭け金×倍率のコインを獲得できます。クラッシュポイントはサーバー側で抽選され、発生するまでサーバーの外に出ることはありません。キャッシュアウトはサーバーの時刻で判定され、オプションの自動キャッシュアウトもサーバー側で執行されるため、タブを閉じても設定していた目標を失うことはありません。負けたフライトは他のゲームと同じくゲーム自体のポットとMega Jackpotに流れ込み、10×を超えて乗り続けることは「月到達」と呼ばれ、50×ではEscape Velocityの実績を獲得できます。",
    heroF3Desc:
      "15 のアーケード ゲーム、XP、レベル、コイン、140 個の実績 — 毎日のルーレットには本物の確率 1 億分の 1 で Twitch Turbo ジャックポット。",
    hubSubtitle: "Twitchバッジのゲーム15種 — BadgesCoinsを賭けてBadgesCoinsを獲得し、XPを稼ごう。",
    coinsA:
      "BadgesCoinsは15種のアーケードゲームで賭けられ、強奪の試行コストとして支払われ、デイリーボーナス・バッジ解除・実績・勝利で獲得できます。",
  },
  ko: {
    crashTitle: "Badge Rocket",
    crashDesc:
      "배율이 오르는 배지 로켓을 타세요 — 폭발하기 전에 캐시아웃하면 모든 코인이 당신의 것입니다.",
    crashHint:
      "발사하면 배율이 1.00×부터 오릅니다 — 로켓이 폭발하기 전에 캐시아웃을 누르세요. 오래 탈수록 배당이 커지고, 10×를 넘기면 달에 도착합니다.",
    crashLaunch: "발사",
    crashCashout: "캐시아웃",
    crashAgain: "다시 발사",
    crashAuto: "자동 캐시아웃",
    crashAutoOff: "꺼짐",
    crashAutoChip: "자동 {mult}×",
    crashCrashedAt: "{mult}×에서 폭발",
    crashCashedAt: "{mult}×에서 캐시아웃",
    crashHistory: "최근 비행",
    crashQ: "Badge Rocket이 무엇이고 언제 캐시아웃해야 하나요?",
    crashA:
      "Badge Rocket은 아케이드의 15번째 게임이자 첫 번째 실시간 인터랙티브 게임입니다. 로켓을 발사하면 배율이 1.00×부터 오릅니다 — 폭발하기 전에 캐시아웃을 누르면 베팅액에 배율을 곱한 만큼을 가져갑니다. 크래시 지점은 서버 측에서 굴려져 실제로 터지기 전까지 서버 밖으로 나가지 않으며, 캐시아웃은 서버 시계로 판정되고 선택적인 자동 캐시아웃도 서버에서 강제 실행되므로 탭을 닫아도 설정해 둔 목표를 잃지 않습니다. 진 비행은 다른 게임과 마찬가지로 이 게임의 잭팟과 Mega Jackpot에 쌓이며, 10×를 넘어 타는 것은 '달 도착'이라 불리고, 50×를 달성하면 Escape Velocity 업적을 획득합니다.",
    heroF3Desc:
      "15개의 아케이드 게임, XP, 레벨, 코인, 140개 업적 — 매일 돌리는 룰렛에는 1억 분의 1의 실제 확률로 Twitch Turbo 잭팟이.",
    hubSubtitle: "Twitch 배지 게임 15종 — BadgesCoins를 걸고 BadgesCoins를 따고 XP를 획득하세요.",
    coinsA:
      "BadgesCoins는 15종 아케이드 게임에 베팅하거나 강탈 시도 비용으로 지불하며, 일일 보너스·배지 해금·업적·승리로 획득합니다.",
  },
  zh: {
    crashTitle: "Badge Rocket",
    crashDesc: "乘上徽章火箭，随倍率一路攀升——爆炸前兑现，每一枚硬币都归你。",
    crashHint:
      "发射后倍率从 1.00× 开始攀升——在火箭爆炸前点击兑现。飞得越久，赢得越多；冲过 10× 就是登月。",
    crashLaunch: "发射",
    crashCashout: "兑现",
    crashAgain: "再次发射",
    crashAuto: "自动兑现",
    crashAutoOff: "关闭",
    crashAutoChip: "自动 {mult}×",
    crashCrashedAt: "爆于 {mult}×",
    crashCashedAt: "兑现于 {mult}×",
    crashHistory: "近期飞行",
    crashQ: "Badge Rocket 是什么？什么时候该兑现？",
    crashA:
      "Badge Rocket 是街机的第 15 个游戏，也是首款实时互动游戏。发射火箭后，倍率从 1.00× 开始攀升——在火箭爆炸前点击兑现，即可将赌注×倍率的奖励收入囊中。爆点由服务器端掷出，发生前绝不会离开服务器；兑现以服务器时钟判定，可选的自动兑现同样由服务器强制执行，因此关掉标签页也不会让你损失已设定的目标。失利的飞行会像其他游戏一样注入本游戏自己的奖池和 Mega Jackpot；飞越 10× 称为“登月”，达到 50× 可获得 Escape Velocity 成就。",
    heroF3Desc:
      "15 款街机游戏、XP、等级、硬币和 140 个成就——还有每日幸运转盘，Twitch Turbo 大奖真实概率为亿分之一。",
    hubSubtitle: "15 款 Twitch 徽章游戏——押注 BadgesCoins，赢取 BadgesCoins，赚取 XP。",
    coinsA:
      "BadgesCoins 可用于押注 15 款街机游戏、支付偷取尝试费用，并通过每日奖励、解锁徽章、成就和游戏胜利获得。",
  },
};

const GAME_KEYS = [
  "crashTitle", "crashDesc", "crashHint", "crashLaunch", "crashCashout",
  "crashAgain", "crashAuto", "crashAutoOff", "crashAutoChip", "crashCrashedAt",
  "crashCashedAt", "crashHistory",
];
const PARAM_KEYS = ["crashAutoChip", "crashCrashedAt", "crashCashedAt"];

function insertAfter(obj, afterKey, additions) {
  const out = {};
  let placed = false;
  for (const [k, v] of Object.entries(obj)) {
    out[k] = v;
    if (k === afterKey) {
      Object.assign(out, additions);
      placed = true;
    }
  }
  if (!placed) Object.assign(out, additions);
  return out;
}

let failures = 0;
for (const locale of Object.keys(T)) {
  const path = `messages/${locale}.json`;
  const raw = fs.readFileSync(path, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error(`ABORT ${path}: does not parse (${e.message})`);
    failures += 1;
    continue;
  }
  // Round-trip guard: the file must be stringify-2 under CRLF with one
  // trailing newline, or our write would reformat unrelated lines.
  const canonical = `${JSON.stringify(parsed, null, 2).replace(/\n/g, "\r\n")}\r\n`;
  if (raw !== canonical) {
    console.error(`ABORT ${path}: not byte-identical to canonical stringify-2/CRLF`);
    failures += 1;
    continue;
  }
  // Anchors: pingu keys exist (key+type), crash keys must not.
  if (typeof parsed.games?.pinguHint !== "string" || typeof parsed.faq?.pinguA !== "string") {
    console.error(`ABORT ${path}: pingo anchor keys missing`);
    failures += 1;
    continue;
  }
  if (typeof parsed.games?.crashTitle !== "undefined") {
    console.error(`ABORT ${path}: crash keys already present`);
    failures += 1;
    continue;
  }
  // The three count strings must exist as strings to be replaced.
  for (const [ns, key] of [["home", "heroF3Desc"], ["games", "hubSubtitle"], ["faq", "coinsA"]]) {
    if (typeof parsed[ns]?.[key] !== "string") {
      console.error(`ABORT ${path}: ${ns}.${key} missing`);
      failures += 1;
    }
  }
  if (failures > 0) continue;

  const values = T[locale];
  const gameAdditions = {};
  for (const key of GAME_KEYS) gameAdditions[key] = values[key];
  parsed.games = insertAfter(parsed.games, "pinguHint", gameAdditions);
  parsed.faq = insertAfter(parsed.faq, "pinguA", {
    crashQ: values.crashQ,
    crashA: values.crashA,
  });
  parsed.home.heroF3Desc = values.heroF3Desc;
  parsed.games.hubSubtitle = values.hubSubtitle;
  parsed.faq.coinsA = values.coinsA;

  fs.writeFileSync(path, `${JSON.stringify(parsed, null, 2).replace(/\n/g, "\r\n")}\r\n`);

  // Post-write assert: re-read, re-parse, every key must have landed.
  const reread = JSON.parse(fs.readFileSync(path, "utf8"));
  const missing = [
    ...GAME_KEYS.filter((k) => typeof reread.games[k] !== "string"),
    ...["crashQ", "crashA"].filter((k) => typeof reread.faq[k] !== "string"),
  ];
  const badParams = PARAM_KEYS.filter((k) => !String(reread.games[k]).includes("{mult}"));
  const countsOk =
    reread.home.heroF3Desc === values.heroF3Desc &&
    reread.games.hubSubtitle === values.hubSubtitle &&
    reread.faq.coinsA === values.coinsA;
  if (missing.length || badParams.length || !countsOk) {
    console.error(`FAIL ${path}: missing=${missing} badParams=${badParams} countsOk=${countsOk}`);
    failures += 1;
  } else {
    console.log(`ok ${path} (+14 keys, 3 counts updated)`);
  }
}
if (failures > 0) {
  console.error(`\n${failures} file(s) FAILED — inspect before committing`);
  process.exit(1);
}
console.log("\nall 11 locales updated");
