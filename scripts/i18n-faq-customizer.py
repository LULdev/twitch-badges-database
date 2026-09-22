"""Remaining translations (bug B1, part 2): FAQ (40) + customizer (27) for the
9 locales that stayed English, plus a vendor-free `faq.dataA` in ALL 11 locales.

`faq.dataA` named the third-party services by name in public UI text; the
replacement keeps the same meaning without naming them (needed for phase 4 of
the same request, so en/de are updated here as well).
"""
import json
import io
import os

NINE = ["es", "fr", "pt", "it", "ru", "zh", "ja", "ko", "ar"]
ALL = ["en", "de"] + NINE

FAQ = {
    "faq.title": [
        "FAQ — Todo sobre XP, BadgesCoins y juegos",
        "FAQ — Tout sur l'XP, les BadgesCoins et les jeux",
        "FAQ — Tudo sobre XP, BadgesCoins e jogos",
        "FAQ — Tutto su XP, BadgesCoins e giochi",
        "FAQ — всё об XP, BadgesCoins и играх",
        "常见问题——关于 XP、BadgesCoins 与游戏的一切",
        "FAQ — XP・BadgesCoins・ゲームのすべて",
        "FAQ — XP, BadgesCoins, 게임의 모든 것",
        "الأسئلة الشائعة — كل ما يخص XP وBadgesCoins والألعاب",
    ],
    "faq.subtitle": [
        "La guía completa del sistema de gamificación.",
        "Le guide complet du système de gamification.",
        "O guia completo do sistema de gamificação.",
        "La guida completa al sistema di gamification.",
        "Полное руководство по игровой системе.",
        "游戏化系统的完整指南。",
        "ゲーミフィケーションの完全ガイド。",
        "게임화 시스템 완전 가이드.",
        "الدليل الكامل لنظام التلعيب.",
    ],
    "faq.whatQ": [
        "¿Qué es el sistema de XP y monedas?",
        "Qu'est-ce que le système d'XP et de pièces ?",
        "O que é o sistema de XP e moedas?",
        "Che cos'è il sistema di XP e monete?",
        "Что такое система XP и монет?",
        "什么是 XP 与硬币系统？",
        "XPとコインの仕組みとは？",
        "XP와 코인 시스템이란?",
        "ما نظام XP والعملات؟",
    ],
    "faq.whatA": [
        "Todo coleccionista registrado gana XP y BadgesCoins: inicio de sesión diario (+10 XP, +50 BadgesCoins), desbloquear insignias de Twitch (+1.000 XP y +500 BadgesCoins cada una), logros (hasta +5.000 XP) y juegos (+2 XP por ronda, +10 por victoria, con un tope de 100 XP al día). El XP sube tu nivel del 1 al 100; los BadgesCoins son la moneda de los juegos y los robos.",
        "Chaque collectionneur connecté gagne de l'XP et des BadgesCoins : connexion quotidienne (+10 XP, +50 BadgesCoins), déblocage de badges Twitch (+1 000 XP et +500 BadgesCoins chacun), succès (jusqu'à +5 000 XP) et jeux (+2 XP par manche, +10 par victoire, plafonné à 100 XP par jour). L'XP fait monter ton niveau de 1 à 100 ; les BadgesCoins sont la monnaie des jeux et des vols.",
        "Todo colecionador logado ganha XP e BadgesCoins: login diário (+10 XP, +50 BadgesCoins), desbloquear emblemas da Twitch (+1.000 XP e +500 BadgesCoins cada), conquistas (até +5.000 XP) e jogos (+2 XP por rodada, +10 por vitória, limitado a 100 XP por dia). O XP sobe seu nível de 1 a 100; os BadgesCoins são a moeda dos jogos e dos roubos.",
        "Ogni collezionista connesso guadagna XP e BadgesCoins: accesso giornaliero (+10 XP, +50 BadgesCoins), sblocco di badge Twitch (+1.000 XP e +500 BadgesCoins ciascuno), obiettivi (fino a +5.000 XP) e giochi (+2 XP per partita, +10 per vittoria, con un tetto di 100 XP al giorno). L'XP aumenta il tuo livello da 1 a 100; i BadgesCoins sono la valuta di giochi e furti.",
        "Каждый вошедший коллекционер получает XP и BadgesCoins: ежедневный вход (+10 XP, +50 BadgesCoins), открытие значков Twitch (+1 000 XP и +500 BadgesCoins за каждый), достижения (до +5 000 XP) и игры (+2 XP за раунд, +10 за победу, не более 100 XP в день). XP повышает уровень с 1 до 100; BadgesCoins — валюта игр и ограблений.",
        "每位登录的收藏者都能获得 XP 与 BadgesCoins：每日登录（+10 XP、+50 BadgesCoins）、解锁 Twitch 徽章（每枚 +1,000 XP 与 +500 BadgesCoins）、成就（最高 +5,000 XP）以及游戏（每局 +2 XP，胜利 +10 XP，每日上限 100 XP）。XP 让你的等级从 1 升到 100；BadgesCoins 是游戏与偷取的货币。",
        "ログインしたコレクターはXPとBadgesCoinsを獲得できます：デイリーログイン（+10 XP、+50 BadgesCoins）、Twitchバッジの解除（1つにつき+1,000 XPと+500 BadgesCoins）、実績（最大+5,000 XP）、ゲーム（1ラウンド+2 XP、勝利+10 XP、1日100 XPまで）。XPでレベルが1〜100に上がり、BadgesCoinsはゲームと強奪の通貨です。",
        "로그인한 수집가는 XP와 BadgesCoins를 얻습니다: 일일 로그인(+10 XP, +50 BadgesCoins), Twitch 배지 해금(개당 +1,000 XP와 +500 BadgesCoins), 업적(최대 +5,000 XP), 게임(라운드당 +2 XP, 승리 시 +10 XP, 하루 100 XP 상한). XP로 레벨이 1에서 100까지 오르고, BadgesCoins는 게임과 강탈의 화폐입니다.",
        "كل جامع مسجّل يكسب XP وBadgesCoins: تسجيل الدخول اليومي (+10 XP و+50 BadgesCoins)، وفتح شارات Twitch (+1,000 XP و+500 BadgesCoins لكل شارة)، والإنجازات (حتى +5,000 XP)، والألعاب (+2 XP لكل جولة و+10 XP لكل فوز، بحد أقصى 100 XP يوميًا). يرفع XP مستواك من 1 إلى 100، وBadgesCoins هي عملة الألعاب والسرقات.",
    ],
    "faq.xpQ": [
        "¿Cómo se otorga exactamente el XP?",
        "Comment l'XP est-il exactement attribué ?",
        "Como o XP é concedido exatamente?",
        "Come viene assegnato esattamente l'XP?",
        "Как именно начисляется XP?",
        "XP 究竟如何发放？",
        "XPは具体的にどう付与される？",
        "XP는 정확히 어떻게 지급되나요?",
        "كيف يُمنح XP بالضبط؟",
    ],
    "faq.xpA": [
        "Inicio de sesión diario +10 XP más +5 por día de racha (máx. +50). Cada insignia de Twitch sincronizada +1.000 XP. Los logros pagan de 50 a 5.000 XP. Los juegos pagan +2 XP por ronda y +10 XP por victoria, con un tope de 100 XP al día para evitar el farmeo. La Ruleta de la fortuna paga de 25 a 2.500 XP por giro.",
        "Connexion quotidienne +10 XP plus +5 par jour de série (max +50). Chaque badge Twitch synchronisé +1 000 XP. Les succès paient de 50 à 5 000 XP. Les jeux paient +2 XP par manche et +10 XP par victoire, plafonné à 100 XP par jour pour éviter le farming. La Roue de la fortune paie de 25 à 2 500 XP par tour.",
        "Login diário +10 XP mais +5 por dia de sequência (máx. +50). Cada emblema da Twitch sincronizado +1.000 XP. As conquistas pagam de 50 a 5.000 XP. Os jogos pagam +2 XP por rodada e +10 XP por vitória, limitado a 100 XP por dia para evitar farm. A Roleta da fortuna paga de 25 a 2.500 XP por giro.",
        "Accesso giornaliero +10 XP più +5 per giorno di serie (max +50). Ogni badge Twitch sincronizzato +1.000 XP. Gli obiettivi pagano da 50 a 5.000 XP. I giochi pagano +2 XP per partita e +10 XP per vittoria, con un tetto di 100 XP al giorno per evitare il farming. La Ruota della fortuna paga da 25 a 2.500 XP per giro.",
        "Ежедневный вход +10 XP плюс +5 за день серии (макс. +50). Каждый синхронизированный значок Twitch +1 000 XP. Достижения дают от 50 до 5 000 XP. Игры дают +2 XP за раунд и +10 XP за победу, не более 100 XP в день против накрутки. Колесо фортуны даёт от 25 до 2 500 XP за вращение.",
        "每日登录 +10 XP，连击每天再 +5 XP（上限 +50）。每枚同步的 Twitch 徽章 +1,000 XP。成就发放 50 至 5,000 XP。游戏每局 +2 XP、胜利 +10 XP，每日上限 100 XP 以防刷分。命运转盘每次旋转发放 25 至 2,500 XP。",
        "デイリーログイン +10 XP、連続日数1日ごとに+5 XP（最大+50）。同期したTwitchバッジ1つにつき+1,000 XP。実績は50〜5,000 XP。ゲームは1ラウンド+2 XP、勝利+10 XPで、不正対策として1日100 XPまで。フォーチュンホイールは1回25〜2,500 XP。",
        "일일 로그인 +10 XP, 연속 접속 하루당 +5 XP(최대 +50). 동기화한 Twitch 배지 1개당 +1,000 XP. 업적은 50~5,000 XP. 게임은 라운드당 +2 XP, 승리 시 +10 XP이며 어뷰징 방지를 위해 하루 100 XP 상한. 운명의 수레바퀴는 회전당 25~2,500 XP.",
        "تسجيل الدخول اليومي ‎+10 XP، و‎+5 XP لكل يوم تتابع (بحد أقصى +50). كل شارة Twitch متزامنة ‎+1,000 XP. الإنجازات تمنح من 50 إلى 5,000 XP. الألعاب تمنح +2 XP لكل جولة و+10 XP لكل فوز، بحد أقصى 100 XP يوميًا لمنع الاستغلال. عجلة الحظ تمنح من 25 إلى 2,500 XP لكل دورة.",
    ],
    "faq.levelsQ": [
        "¿Cómo funcionan los niveles del 1 al 100?",
        "Comment fonctionnent les niveaux 1 à 100 ?",
        "Como funcionam os níveis de 1 a 100?",
        "Come funzionano i livelli da 1 a 100?",
        "Как работают уровни с 1 по 100?",
        "1 到 100 级如何运作？",
        "レベル1〜100の仕組みは？",
        "레벨 1~100은 어떻게 작동하나요?",
        "كيف تعمل المستويات من 1 إلى 100؟",
    ],
    "faq.levelsA": [
        "El nivel 1 empieza en 0 XP. Cada nivel necesita 100 + (nivel-1) x 50 XP — el nivel 100 suma 254.900 XP. Cada nivel tiene una insignia única con animación de destellos en tu perfil, siempre visible e imposible de ocultar.",
        "Le niveau 1 commence à 0 XP. Chaque niveau demande 100 + (niveau-1) x 50 XP — le niveau 100 totalise 254 900 XP. Chaque niveau a un badge unique animé d'étincelles dans ton profil, toujours visible et impossible à masquer.",
        "O nível 1 começa em 0 XP. Cada nível exige 100 + (nível-1) x 50 XP — o nível 100 soma 254.900 XP. Cada nível tem um emblema único com animação de brilho no seu perfil, sempre visível e impossível de ocultar.",
        "Il livello 1 parte da 0 XP. Ogni livello richiede 100 + (livello-1) x 50 XP — il livello 100 totalizza 254.900 XP. Ogni livello ha un badge unico con animazione scintillante nel profilo, sempre visibile e impossibile da nascondere.",
        "Уровень 1 начинается с 0 XP. Каждый уровень требует 100 + (уровень-1) x 50 XP — уровень 100 в сумме даёт 254 900 XP. У каждого уровня есть уникальный значок со сверкающей анимацией в профиле, всегда видимый и неотключаемый.",
        "1 级从 0 XP 开始。每级需要 100 + (等级-1) × 50 XP——100 级共需 254,900 XP。每个等级都有一枚独特的闪烁动画等级徽章，在主页始终可见且无法隐藏。",
        "レベル1は0 XPから。各レベルに100 + (レベル-1) x 50 XPが必要で、レベル100の合計は254,900 XP。各レベルにはキラキラ動く専用バッジがプロフィールに表示され、常に表示され隠せません。",
        "레벨 1은 0 XP에서 시작합니다. 각 레벨은 100 + (레벨-1) x 50 XP가 필요하며 레벨 100의 총합은 254,900 XP입니다. 모든 레벨에 반짝이는 애니메이션 배지가 프로필에 표시되며 항상 보이고 숨길 수 없습니다.",
        "يبدأ المستوى 1 من 0 XP. يحتاج كل مستوى إلى 100 + (المستوى-1) × 50 XP — والمستوى 100 يبلغ مجموع 254,900 XP. لكل مستوى شارة متحركة بالبريق خاصة به في ملفك، تظهر دائمًا ولا يمكن إخفاؤها.",
    ],
    "faq.coinsQ": [
        "¿Qué hago con los BadgesCoins?",
        "Que faire avec les BadgesCoins ?",
        "O que fazer com os BadgesCoins?",
        "Cosa faccio con i BadgesCoins?",
        "Что делать с BadgesCoins?",
        "我可以用 BadgesCoins 做什么？",
        "BadgesCoinsで何ができる？",
        "BadgesCoins로 무엇을 하나요?",
        "ماذا أفعل بـ BadgesCoins؟",
    ],
    "faq.coinsA": [
        "Los BadgesCoins se apuestan en los 13 juegos arcade, se pagan como coste de intento en los robos y se ganan con bonos diarios, insignias desbloqueadas, logros y victorias. Pronto habrá más usos cosméticos.",
        "Les BadgesCoins se misent dans les 13 jeux d'arcade, servent de coût de tentative lors des vols et s'obtiennent via les bonus quotidiens, les badges débloqués, les succès et les victoires.",
        "Os BadgesCoins são apostados nos 13 jogos arcade, pagos como custo de tentativa nos roubos e ganhos em bônus diários, emblemas desbloqueados, conquistas e vitórias.",
        "I BadgesCoins si puntano nei 13 giochi arcade, si pagano come costo di tentativo nei furti e si ottengono con bonus giornalieri, badge sbloccati, obiettivi e vittorie.",
        "BadgesCoins ставятся в 13 аркадных играх, оплачивают попытки ограблений и зарабатываются на ежедневных бонусах, открытых значках, достижениях и победах.",
        "BadgesCoins 可用于押注 13 款街机游戏、支付偷取尝试费用，并通过每日奖励、解锁徽章、成就和游戏胜利获得。",
        "BadgesCoinsは13種のアーケードゲームで賭けられ、強奪の試行コストとして支払われ、デイリーボーナス・バッジ解除・実績・勝利で獲得できます。",
        "BadgesCoins는 13종 아케이드 게임에 베팅하거나 강탈 시도 비용으로 지불하며, 일일 보너스·배지 해금·업적·승리로 획득합니다.",
        "تُستخدم BadgesCoins للمراهنة في 13 لعبة أركيد، وتُدفع كتكلفة محاولة في السرقات، وتُكسب من المكافآت اليومية والشارات المفتوحة والإنجازات والانتصارات.",
    ],
    "faq.dailyQ": [
        "¿Cómo funciona el bono de inicio de sesión diario?",
        "Comment fonctionne le bonus de connexion quotidien ?",
        "Como funciona o bônus de login diário?",
        "Come funziona il bonus di accesso giornaliero?",
        "Как работает ежедневный бонус за вход?",
        "每日登录奖励如何运作？",
        "デイリーログインボーナスの仕組みは？",
        "일일 로그인 보너스는 어떻게 작동하나요?",
        "كيف تعمل مكافأة تسجيل الدخول اليومي؟",
    ],
    "faq.dailyA": [
        "Reclámalo una vez al día en el centro de juegos o en tu inventario: +10 XP y +50 BadgesCoins. Los días consecutivos crean una racha que añade hasta +50 XP y +250 BadgesCoins extra al día.",
        "Récupère-le une fois par jour dans le hub de jeux ou ton inventaire : +10 XP et +50 BadgesCoins. Les jours consécutifs créent une série qui ajoute jusqu'à +50 XP et +250 BadgesCoins bonus par jour.",
        "Resgate uma vez por dia no hub de jogos ou no seu inventário: +10 XP e +50 BadgesCoins. Dias consecutivos criam uma sequência que adiciona até +50 XP e +250 BadgesCoins extras por dia.",
        "Riscattalo una volta al giorno nell'hub dei giochi o nell'inventario: +10 XP e +50 BadgesCoins. I giorni consecutivi creano una serie che aggiunge fino a +50 XP e +250 BadgesCoins extra al giorno.",
        "Забирайте раз в день в игровом центре или инвентаре: +10 XP и +50 BadgesCoins. Последовательные дни создают серию, добавляющую до +50 XP и +250 BadgesCoins в день.",
        "每天可在游戏中心或库存页面领取一次：+10 XP 与 +50 BadgesCoins。连续天数会形成连击，每天额外最多 +50 XP 与 +250 BadgesCoins。",
        "ゲームハブかインベントリで1日1回受け取れます：+10 XPと+50 BadgesCoins。連続日数でストリークが伸び、1日あたり最大+50 XPと+250 BadgesCoinsが追加されます。",
        "게임 허브나 인벤토리에서 하루 한 번 받으세요: +10 XP와 +50 BadgesCoins. 연속 접속 시 스트릭이 쌓여 하루 최대 +50 XP와 +250 BadgesCoins가 추가됩니다.",
        "استلمها مرة واحدة يوميًا في مركز الألعاب أو صفحة المقتنيات: ‎+10 XP و+50 BadgesCoins. الأيام المتتالية تبني سلسلة تضيف حتى +50 XP و+250 BadgesCoins يوميًا.",
    ],
    "faq.wheelQ": [
        "¿Con qué frecuencia puedo girar la Ruleta de la fortuna?",
        "À quelle fréquence puis-je tourner la Roue de la fortune ?",
        "Com que frequência posso girar a Roleta da fortuna?",
        "Quanto spesso posso girare la Ruota della fortuna?",
        "Как часто можно крутить Колесо фортуны?",
        "我可以多久转一次命运转盘？",
        "フォーチュンホイールはどのくらい回せる？",
        "운명의 수레바퀴는 얼마나 자주 돌릴 수 있나요?",
        "كم مرة يمكنني إدارة عجلة الحظ؟",
    ],
    "faq.wheelA": [
        "Una vez al día. Los premios van de +25 XP (lo más común) a +2.500 XP (muy raro), cada uno con BadgesCoins extra.",
        "Une fois par jour. Les prix vont de +25 XP (le plus courant) à +2 500 XP (très rare), chacun avec des BadgesCoins bonus.",
        "Uma vez por dia. Os prêmios vão de +25 XP (mais comum) a +2.500 XP (muito raro), cada um com BadgesCoins extras.",
        "Una volta al giorno. I premi vanno da +25 XP (più comune) a +2.500 XP (molto raro), ciascuno con BadgesCoins extra.",
        "Раз в день. Призы от +25 XP (самый частый) до +2 500 XP (очень редкий), каждый с бонусными BadgesCoins.",
        "每天一次。奖励从 +25 XP（最常见）到 +2,500 XP（极稀有），各自还附带 BadgesCoins。",
        "1日1回。賞品は+25 XP（最も一般的）から+2,500 XP（非常にレア）まで、いずれもBadgesCoins付き。",
        "하루 한 번. 상금은 +25 XP(가장 흔함)부터 +2,500 XP(매우 희귀)까지이며 각각 BadgesCoins가 함께 지급됩니다.",
        "مرة واحدة يوميًا. تتراوح الجوائز من +25 XP (الأكثر شيوعًا) إلى +2,500 XP (نادرة جدًا)، وكل منها مع BadgesCoins إضافية.",
    ],
    "faq.turboQ": [
        "¿Es real el jackpot de Twitch Turbo?",
        "Le jackpot Twitch Turbo est-il réel ?",
        "O jackpot do Twitch Turbo é real?",
        "Il jackpot Twitch Turbo è reale?",
        "Джекпот Twitch Turbo настоящий?",
        "Twitch Turbo 头奖是真的吗？",
        "Twitch Turboジャックポットは本当にある？",
        "Twitch Turbo 잭팟은 진짜인가요?",
        "هل جاكبوت Twitch Turbo حقيقي؟",
    ],
    "faq.turboA": [
        "Sí — una casilla de la ruleta contiene una suscripción gratuita a Twitch Turbo con una probabilidad exacta de 0,00000001 (1 : 100.000.000), junto con 5.000 XP y 50.000 BadgesCoins.",
        "Oui — une case de la roue contient un abonnement Twitch Turbo gratuit avec une probabilité exacte de 0,00000001 (1 : 100 000 000), ainsi que 5 000 XP et 50 000 BadgesCoins.",
        "Sim — uma casa da roleta contém uma assinatura gratuita do Twitch Turbo com probabilidade exata de 0,00000001 (1 : 100.000.000), além de 5.000 XP e 50.000 BadgesCoins.",
        "Sì — uno slot della ruota contiene un abbonamento Twitch Turbo gratuito con probabilità esatta di 0,00000001 (1 : 100.000.000), insieme a 5.000 XP e 50.000 BadgesCoins.",
        "Да — один слот колеса содержит бесплатную подписку Twitch Turbo с точной вероятностью 0,00000001 (1 : 100 000 000), а также 5 000 XP и 50 000 BadgesCoins.",
        "是的——转盘的一个格子包含免费 Twitch Turbo 订阅，中奖概率恰为 0.00000001（1 : 100,000,000），并附带 5,000 XP 与 50,000 BadgesCoins。",
        "はい — ホイールの1枠に無料のTwitch Turbo定期購読が入っており、確率は正確に0.00000001（1 : 100,000,000）。あわせて5,000 XPと50,000 BadgesCoins。",
        "네 — 수레바퀴 한 칸에 무료 Twitch Turbo 구독이 있으며 확률은 정확히 0.00000001 (1 : 100,000,000)이고, 5,000 XP와 50,000 BadgesCoins도 함께 지급됩니다.",
        "نعم — تحتوي إحدى خانات العجلة على اشتراك Twitch Turbo مجاني باحتمال دقيق 0.00000001 (1 : 100,000,000)، مع 5,000 XP و50,000 BadgesCoins.",
    ],
    "faq.badgesQ": [
        "¿Mis insignias de Twitch dan XP?",
        "Mes badges Twitch rapportent-ils de l'XP ?",
        "Meus emblemas da Twitch dão XP?",
        "I miei badge Twitch danno XP?",
        "Мои значки Twitch дают XP?",
        "我的 Twitch 徽章能给 XP 吗？",
        "TwitchバッジでXPはもらえる？",
        "Twitch 배지로 XP를 받나요?",
        "هل تمنحني شارات Twitch XP؟",
    ],
    "faq.badgesA": [
        "¡Sí! Sincroniza tus insignias tras iniciar sesión — cada insignia recién desbloqueada paga +1.000 XP y +500 BadgesCoins y aparece en el feed en vivo.",
        "Oui ! Synchronise tes badges après connexion — chaque badge débloqué paie +1 000 XP et +500 BadgesCoins et apparaît dans le fil en direct.",
        "Sim! Sincronize seus emblemas após o login — cada emblema recém-desbloqueado paga +1.000 XP e +500 BadgesCoins e aparece no feed ao vivo.",
        "Sì! Sincronizza i tuoi badge dopo l'accesso — ogni badge appena sbloccato paga +1.000 XP e +500 BadgesCoins e compare nel feed in diretta.",
        "Да! Синхронизируйте значки после входа — каждый новый значок даёт +1 000 XP и +500 BadgesCoins и появляется в ленте.",
        "是的！登录后同步你的徽章——每枚新解锁的徽章支付 +1,000 XP 与 +500 BadgesCoins，并出现在实时动态中。",
        "はい！ログイン後にバッジを同期すると、新たに解除したバッジ1つにつき+1,000 XPと+500 BadgesCoinsが支払われ、ライブフィードに表示されます。",
        "네! 로그인 후 배지를 동기화하면 새로 해금한 배지마다 +1,000 XP와 +500 BadgesCoins가 지급되고 실시간 피드에 표시됩니다.",
        "نعم! زامن شاراتك بعد تسجيل الدخول — كل شارة جديدة تمنح ‎+1,000 XP و+500 BadgesCoins وتظهر في الخلاصة المباشرة.",
    ],
    "faq.gamesQ": [
        "¿Son justos los juegos?",
        "Les jeux sont-ils équitables ?",
        "Os jogos são justos?",
        "I giochi sono equi?",
        "Игры честные?",
        "游戏公平吗？",
        "ゲームは公平ですか？",
        "게임은 공정한가요?",
        "هل الألعاب عادلة؟",
    ],
    "faq.gamesA": [
        "Todos los resultados de azar (tragaperras, ruleta, ruleta de la fortuna, cara o cruz, blackjack, rasca, torre) se generan en el servidor y no se pueden manipular. Los juegos de habilidad (disparos, memoria, atrapa) validan la puntuación en el servidor con límites.",
        "Tous les résultats de hasard (machine à sous, roulette, roue, pile ou face, blackjack, gratte, tour) sont générés sur le serveur et ne peuvent pas être manipulés. Les jeux d'adresse (tir, mémoire, attrape) font vérifier le score côté serveur avec des plafonds.",
        "Todos os resultados de azar (caça-níqueis, roleta, roleta da fortuna, cara ou coroa, blackjack, raspadinha, torre) são gerados no servidor e não podem ser manipulados. Os jogos de habilidade (tiro, memória, cesta) validam a pontuação no servidor com limites.",
        "Tutti gli esiti casuali (slot, roulette, ruota, testa o croce, blackjack, gratta, torre) sono generati sul server e non possono essere manipolati. I giochi di abilità (tiro, memoria, cesto) verificano il punteggio lato server con dei limiti.",
        "Все случайные исходы (слоты, рулетка, колесо, монетка, блэкджек, скретч, башня) генерируются на сервере и не могут быть подделаны. Игры на навык (стрельба, память, ловля) проверяют счёт на сервере с ограничениями.",
        "所有运气类结果（老虎机、轮盘、转盘、抛硬币、21 点、刮刮乐、高塔）均由服务器生成，无法操控。技巧类游戏（射击、记忆、接取）的成绩在服务器端校验并设上限。",
        "運要素の結果（スロット、ルーレット、ホイール、コイントス、ブラックジャック、スクラッチ、タワー）はすべてサーバーで生成され、操作できません。スキル系（シューティング、記憶、キャッチ）はスコアをサーバー側で上限付きで検証します。",
        "운에 따른 결과(슬롯, 룰렛, 수레바퀴, 동전 던지기, 블랙잭, 스크래치, 탑)는 모두 서버에서 생성되어 조작할 수 없습니다. 실력 게임(사격, 기억, 받기)은 서버에서 상한과 함께 점수를 검증합니다.",
        "كل نتائج الحظ (السلوت والروليت وعجلة الحظ ورمي العملة والبلاك جاك والكشط والبرج) تُولَّد على الخادم ولا يمكن التلاعب بها. أما ألعاب المهارة (التصويب والذاكرة والتقاط) فيتحقق الخادم من نتيجتها مع حدود قصوى.",
    ],
    "faq.achievementsQ": [
        "¿Cuántos logros hay?",
        "Combien de succès existe-t-il ?",
        "Quantas conquistas existem?",
        "Quanti obiettivi ci sono?",
        "Сколько всего достижений?",
        "有多少个成就？",
        "実績はいくつある？",
        "업적은 몇 개인가요?",
        "كم عدد الإنجازات؟",
    ],
    "faq.achievementsA": [
        "{total}: {common} hitos comunes, {creative} retos creativos y {special} especiales realmente inesperados. Cada uno otorga XP, BadgesCoins y puntos, además de una insignia brillante en la vitrina de logros de tu perfil.",
        "{total} : {common} jalons communs, {creative} défis créatifs et {special} spéciaux vraiment inattendus. Chacun donne de l'XP, des BadgesCoins et des points, plus un badge scintillant dans la vitrine de succès de ton profil.",
        "{total}: {common} marcos comuns, {creative} desafios criativos e {special} especiais realmente inesperados. Cada um dá XP, BadgesCoins e pontos, além de um emblema brilhante na vitrine de conquistas do seu perfil.",
        "{total}: {common} traguardi comuni, {creative} sfide creative e {special} speciali davvero inaspettati. Ognuno dà XP, BadgesCoins e punti, più un badge scintillante nella vetrina obiettivi del profilo.",
        "{total}: {common} обычных вех, {creative} творческих испытаний и {special} действительно неожиданных особых. Каждое даёт XP, BadgesCoins и очки, а также сверкающий значок в витрине достижений вашего профиля.",
        "{total} 个：{common} 个普通里程碑、{creative} 个创意挑战和 {special} 个真正意想不到的特殊成就。每个都奖励 XP、BadgesCoins 和积分，并在主页成就展柜中显示一枚闪亮徽章。",
        "{total}種：コモンの節目{common}、クリエイティブな挑戦{creative}、まさかのスペシャル{special}。それぞれXP・BadgesCoins・ポイントがもらえ、プロフィールの実績ショーケースにキラキラバッジが並びます。",
        "{total}개: 일반 이정표 {common}, 창의적 도전 {creative}, 진짜 예상 밖의 특별 {special}. 각각 XP, BadgesCoins, 포인트를 주고 프로필 업적 쇼케이스에 반짝이는 배지가 표시됩니다.",
        "{total} إنجازًا: {common} محطة عادية و{creative} تحديًا إبداعيًا و{special} خاصًا مفاجئًا حقًا. كل منها يمنح XP وBadgesCoins ونقاطًا، مع شارة لامعة في واجهة إنجازات ملفك.",
    ],
    "faq.stealQ": [
        "¿Cómo funciona robar BadgesCoins?",
        "Comment fonctionne le vol de BadgesCoins ?",
        "Como funciona roubar BadgesCoins?",
        "Come funziona rubare BadgesCoins?",
        "Как работает кража BadgesCoins?",
        "偷取 BadgesCoins 如何运作？",
        "BadgesCoinsの強奪の仕組みは？",
        "BadgesCoins 훔치기는 어떻게 작동하나요?",
        "كيف تعمل سرقة BadgesCoins؟",
    ],
    "faq.stealA": [
        "Abre el perfil de otro coleccionista e intenta un golpe. La víctima fija el precio del intento y el botín máximo; la probabilidad de éxito (20 a 80 por ciento) varía según la diferencia de nivel entre ambos. Los intentos fallidos pagan el precio a la víctima.",
        "Ouvre le profil d'un autre collectionneur et tente un braquage. La victime fixe le prix de la tentative et le butin maximal ; la probabilité de réussite (20 à 80 %) varie selon l'écart de niveau. Les tentatives échouées versent le prix à la victime.",
        "Abra o perfil de outro colecionador e tente um assalto. A vítima define o preço da tentativa e o saque máximo; a chance de sucesso (20 a 80 por cento) varia com a diferença de nível entre vocês. Tentativas falhas pagam o preço à vítima.",
        "Apri il profilo di un altro collezionista e tenta un colpo. La vittima imposta il prezzo del tentativo e il bottino massimo; la probabilità di successo (20-80 per cento) dipende dal divario di livello. I tentativi falliti pagano il prezzo alla vittima.",
        "Откройте профиль другого коллекционера и попробуйте ограбление. Жертва задаёт цену попытки и максимум добычи; шанс успеха (20–80 %) зависит от разницы уровней. Неудачные попытки отдают цену жертве.",
        "打开其他收藏者的主页并发起一次偷取。受害者设定尝试价格与最大收获；成功率（20% 至 80%）随你们之间的等级差变化。失败时价格归受害者所有。",
        "他のコレクターのプロフィールを開いて強奪に挑戦。試行価格と最大獲得額は相手が設定し、成功率（20〜80%）は二人のレベル差で変わります。失敗時は価格が相手に支払われます。",
        "다른 수집가의 프로필을 열고 강탈을 시도하세요. 시도 비용과 최대 습득액은 상대가 정하며, 성공률(20~80%)은 두 사람의 레벨 차에 따라 달라집니다. 실패하면 비용은 상대에게 지급됩니다.",
        "افتح ملف جامع آخر وحاول السرقة. تحدد الضحية تكلفة المحاولة وأقصى غنيمة، ويتراوح احتمال النجاح (20 إلى 80 بالمئة) حسب فرق المستوى بينكما. المحاولات الفاشلة تُدفع تكلفتها للضحية.",
    ],
    "faq.stealCostQ": [
        "¿Puedo protegerme de los ladrones?",
        "Puis-je me protéger des voleurs ?",
        "Posso me proteger de ladrões?",
        "Posso proteggermi dai ladri?",
        "Можно ли защититься от воров?",
        "我能防住小偷吗？",
        "泥棒から身を守れる？",
        "도둑으로부터 나를 보호할 수 있나요?",
        "هل يمكنني حماية نفسي من السارقين؟",
    ],
    "faq.stealCostA": [
        "En tus ajustes puedes desactivar el robo por completo, fijar el precio del intento y limitar el botín máximo. Un control de flujo limita los golpes a uno por víctima cada 5 minutos y 6 por hora.",
        "Dans tes réglages, tu peux désactiver complètement le vol, fixer le prix de la tentative et plafonner le butin maximal. Un contrôle de flux limite les braquages à un par victime toutes les 5 minutes et 6 par heure.",
        "Nas suas configurações você pode desativar o roubo por completo, definir o preço da tentativa e limitar o saque máximo. Um controle de fluxo limita os assaltos a um por vítima a cada 5 minutos e 6 por hora.",
        "Nelle impostazioni puoi disattivare del tutto i furti, impostare il prezzo del tentativo e limitare il bottino massimo. Un controllo di flusso limita i colpi a uno per vittima ogni 5 minuti e 6 all'ora.",
        "В настройках можно полностью отключить кражи, задать цену попытки и ограничить максимум добычи. Ограничение частоты допускает одно ограбление на жертву за 5 минут и 6 в час.",
        "在设置中可以完全关闭偷取、设定尝试价格并限制最大收获。频率限制为每位受害者每 5 分钟一次、每小时 6 次。",
        "設定で強奪を完全に無効化し、試行価格と最大獲得額を設定できます。フラッド制限により、同じ相手には5分に1回、1時間に6回までです。",
        "설정에서 강탈을 완전히 끄고 시도 비용과 최대 습득액을 정할 수 있습니다. 속도 제한으로 같은 상대에게 5분에 1회, 시간당 6회까지 가능합니다.",
        "في إعداداتك يمكنك تعطيل السرقة تمامًا وتحديد تكلفة المحاولة وسقف الغنيمة. ويحدّ نظام منع الإغراق السرقات بمحاولة واحدة لكل ضحية كل 5 دقائق و6 في الساعة.",
    ],
    "faq.feedQ": [
        "¿Qué aparece en el feed en vivo?",
        "Qu'apparaît dans le fil en direct ?",
        "O que aparece no feed ao vivo?",
        "Cosa compare nel feed in diretta?",
        "Что попадает в живую ленту?",
        "实时动态里会出现什么？",
        "ライブフィードには何が表示される？",
        "실시간 피드에는 무엇이 표시되나요?",
        "ماذا يظهر في الخلاصة المباشرة؟",
    ],
    "faq.feedA": [
        "Cada XP ganado: bonos diarios, insignias desbloqueadas, giros de ruleta, rondas de juego, logros, subidas de nivel, robos, lluvias de monedas y jackpots — de todos los coleccionistas, actualizándose cada pocos segundos.",
        "Chaque XP gagné : bonus quotidiens, badges débloqués, tours de roue, manches de jeu, succès, montées de niveau, vols, pluies de pièces et jackpots — de tous les collectionneurs, actualisé toutes les quelques secondes.",
        "Cada XP ganho: bônus diários, emblemas desbloqueados, giros da roleta, rodadas de jogo, conquistas, subidas de nível, roubos, chuvas de moedas e jackpots — de todos os colecionadores, atualizando a cada poucos segundos.",
        "Ogni XP guadagnato: bonus giornalieri, badge sbloccati, giri della ruota, partite, obiettivi, salite di livello, furti, piogge di monete e jackpot — di tutti i collezionisti, aggiornato ogni pochi secondi.",
        "Каждый заработанный XP: ежедневные бонусы, открытые значки, вращения колеса, игровые раунды, достижения, повышения уровня, кражи, дожди монет и джекпоты — от всех коллекционеров, обновляется каждые несколько секунд.",
        "每一次 XP 变动：每日奖励、解锁徽章、转盘旋转、游戏对局、成就、升级、偷取、硬币雨与头奖——来自所有收藏者，每几秒刷新。",
        "すべてのXP獲得：デイリーボーナス、バッジ解除、ホイール回転、ゲームのラウンド、実績、レベルアップ、強奪、コインの雨、ジャックポット — 全コレクター分が数秒ごとに更新。",
        "모든 XP 획득: 일일 보너스, 배지 해금, 수레바퀴 회전, 게임 라운드, 업적, 레벨 업, 강탈, 코인 비, 잭팟 — 모든 수집가의 활동이 몇 초마다 갱신됩니다.",
        "كل XP مكتسب: المكافآت اليومية والشارات المفتوحة ودورات العجلة وجولات الألعاب والإنجازات وارتفاعات المستوى والسرقات وأمطار العملات والجوائز — من جميع الجامعين، ويتحدث كل بضع ثوانٍ.",
    ],
    "faq.profileQ": [
        "¿Cuánto puedo personalizar mi perfil?",
        "À quel point mon profil est-il personnalisable ?",
        "Quanto posso personalizar meu perfil?",
        "Quanto posso personalizzare il profilo?",
        "Насколько настраиваем профиль?",
        "我的主页可以定制到什么程度？",
        "プロフィールはどこまでカスタマイズできる？",
        "프로필은 얼마나 커스터마이즈할 수 있나요?",
        "إلى أي مدى يمكن تخصيص ملفي؟",
    ],
    "faq.profileA": [
        "35 ajustes: 20 comunes (colores, fuentes, banner, estilo de tarjeta, marcos, controles de privacidad, enlaces sociales) y 15 extras creativos (aura, fondo de partículas, nombre arcoíris, inclinación 3D, avatar pixelado, ticker de logros y más).",
        "35 réglages : 20 communs (couleurs, polices, bannière, style de carte, cadres, options de confidentialité, liens sociaux) et 15 extras créatifs (aura, fond de particules, nom arc-en-ciel, inclinaison 3D, avatar pixelisé, bandeau de succès, etc.).",
        "35 ajustes: 20 comuns (cores, fontes, banner, estilo de cartão, molduras, controles de privacidade, links sociais) e 15 extras criativos (aura, fundo de partículas, nome arco-íris, inclinação 3D, avatar pixelado, ticker de conquistas e mais).",
        "35 impostazioni: 20 comuni (colori, font, banner, stile scheda, cornici, opzioni privacy, link sociali) e 15 extra creativi (aura, sfondo di particelle, nome arcobaleno, inclinazione 3D, avatar pixelato, ticker obiettivi e altro).",
        "35 настроек: 20 обычных (цвета, шрифты, баннер, стиль карточки, рамки, приватность, соцсети) и 15 творческих (аура, частицы, радужное имя, 3D-наклон, пиксельный аватар, бегущая строка достижений и другое).",
        "35 项设置：20 项常规（颜色、字体、横幅、卡片样式、相框、隐私开关、社交链接）和 15 项创意扩展（光环、粒子背景、彩虹名字、3D 倾斜、像素头像、成就跑马灯等）。",
        "設定は35項目：一般20（色、フォント、バナー、カードスタイル、フレーム、プライバシー、SNSリンク）とクリエイティブ15（オーラ、パーティクル背景、レインボーネーム、3Dチルト、ピクセルアバター、実績ティッカーなど）。",
        "설정 35가지: 일반 20(색상, 글꼴, 배너, 카드 스타일, 프레임, 공개 범위, 소셜 링크)과 창의 15(오라, 입자 배경, 무지개 이름, 3D 기울기, 픽셀 아바타, 업적 티커 등).",
        "35 إعدادًا: 20 عادية (الألوان والخطوط واللافتة ونمط البطاقة والإطارات وضوابط الخصوصية وروابط التواصل) و15 إضافية إبداعية (الهالة وخلفية الجزيئات والاسم بألوان قوس قزح والإمالة ثلاثية الأبعاد والصورة الرمزية النقطية وشريط الإنجازات وغيرها).",
    ],
    "faq.visitorsQ": [
        "¿Quién visitó mi perfil?",
        "Qui a visité mon profil ?",
        "Quem visitou meu perfil?",
        "Chi ha visitato il mio profilo?",
        "Кто заходил в мой профиль?",
        "谁访问了我的主页？",
        "誰がプロフィールを見た？",
        "누가 내 프로필을 방문했나요?",
        "من زار ملفي؟",
    ],
    "faq.visitorsA": [
        "Tu perfil muestra el total de visitas y los últimos visitantes como avatares. Todos los contadores usan un bloqueo de recarga de 5 minutos por IP para que refrescar no infle las cifras.",
        "Ton profil affiche le total des vues et les derniers visiteurs sous forme d'avatars. Tous les compteurs appliquent un blocage de 5 minutes par IP pour que le rafraîchissement ne gonfle pas les chiffres.",
        "Seu perfil mostra o total de visualizações e os últimos visitantes como avatares. Todos os contadores usam bloqueio de recarga de 5 minutos por IP para que atualizar não infle os números.",
        "Il tuo profilo mostra il totale delle visite e gli ultimi visitatori come avatar. Tutti i contatori usano un blocco di ricarica di 5 minuti per IP, così ricaricare non gonfia i numeri.",
        "Ваш профиль показывает общее число просмотров и последних посетителей в виде аватаров. Все счётчики используют 5-минутную блокировку по IP, чтобы перезагрузка не накручивала цифры.",
        "你的主页显示总访问量与最近访客头像。所有浏览计数均按 IP 设置 5 分钟刷新限制，避免反复刷新虚增数字。",
        "プロフィールには総閲覧数と最近の訪問者がアバターで表示されます。すべてのカウンターはIPごとに5分の再読み込み制限があり、更新しても数字は水増しされません。",
        "프로필에는 총 조회수와 최근 방문자가 아바타로 표시됩니다. 모든 카운터는 IP당 5분 새로고침 제한이 있어 새로고침해도 수치가 부풀지 않습니다.",
        "يعرض ملفك إجمالي المشاهدات وأحدث الزوار كصور رمزية. وتستخدم كل العدّادات فترة منع 5 دقائق لكل عنوان IP حتى لا تتضخم الأرقام بإعادة التحميل.",
    ],
    "faq.rainQ": [
        "¿Qué es una lluvia de monedas?",
        "Qu'est-ce qu'une pluie de pièces ?",
        "O que é uma chuva de moedas?",
        "Che cos'è una pioggia di monete?",
        "Что такое дождь монет?",
        "什么是硬币雨？",
        "コインの雨とは？",
        "코인 비란 무엇인가요?",
        "ما هو مطر العملات؟",
    ],
    "faq.rainA": [
        "Una lluvia de monedas es un pequeño regalo: cualquier visitante puede activar una lluvia de monedas al día en tu perfil, dándote +1 moneda con una pequeña animación.",
        "Une pluie de pièces est un petit cadeau : n'importe quel visiteur peut déclencher une pluie de pièces par jour sur ton profil, te donnant +1 pièce avec une petite animation.",
        "Uma chuva de moedas é um pequeno presente: qualquer visitante pode acionar uma chuva de moedas por dia no seu perfil, dando +1 moeda com uma pequena animação.",
        "Una pioggia di monete è un piccolo regalo: qualsiasi visitatore può attivare una pioggia di monete al giorno sul tuo profilo, dandoti +1 moneta con una piccola animazione.",
        "Дождь монет — небольшой подарок: любой посетитель может раз в день запустить его в вашем профиле и подарить +1 монету с небольшой анимацией.",
        "硬币雨是一份小礼物：任何访客每天都能在你的主页触发一次硬币雨，以一段小动画送上 +1 硬币。",
        "コインの雨はちょっとしたギフト：訪問者は1日1回あなたのプロフィールで発動でき、小さなアニメーションとともに+1コインを贈ります。",
        "코인 비는 작은 선물입니다: 방문자는 하루 한 번 프로필에서 코인 비를 일으켜 작은 애니메이션과 함께 +1 코인을 줍니다.",
        "مطر العملات هدية صغيرة: يمكن لأي زائر إطلاقه مرة واحدة يوميًا في ملفك، ليمنحك عملة واحدة مع حركة صغيرة.",
    ],
    "faq.blogQ": [
        "¿Dónde puedo leer más sobre las funciones?",
        "Où puis-je en lire plus sur les fonctionnalités ?",
        "Onde posso ler mais sobre os recursos?",
        "Dove posso leggere di più sulle funzioni?",
        "Где подробнее о возможностях?",
        "我在哪里能了解更多功能？",
        "機能についてもっと読める場所は？",
        "기능에 대해 더 읽을 수 있는 곳은?",
        "أين يمكنني قراءة المزيد عن الميزات؟",
    ],
    "faq.blogA": [
        "Cada juego y función tiene su propia entrada de blog detallada con al menos 300 palabras, contador de visitas y reacciones con emoji. Los nuevos lanzamientos y los jackpots se anuncian allí automáticamente.",
        "Chaque jeu et fonctionnalité a son propre article détaillé d'au moins 300 mots, avec compteur de vues et réactions emoji. Les nouveautés et les jackpots y sont annoncés automatiquement.",
        "Cada jogo e recurso tem seu próprio post detalhado com pelo menos 300 palavras, contador de visitas e reações com emoji. Novos lançamentos e jackpots são anunciados lá automaticamente.",
        "Ogni gioco e funzione ha il proprio articolo dettagliato di almeno 300 parole, con contatore di visite e reazioni emoji. Nuove uscite e jackpot vengono annunciati lì automaticamente.",
        "У каждой игры и функции есть отдельная подробная статья объёмом не менее 300 слов, со счётчиком просмотров и emoji-реакциями. Новые дропы и джекпоты анонсируются там автоматически.",
        "每款游戏与功能都有各自至少 300 字的详细博文，含浏览量计数与表情互动。新的掉落与头奖会自动在那里公布。",
        "各ゲーム・機能には300語以上の詳細なブログ記事があり、閲覧数と絵文字リアクション付き。新ドロップやジャックポットも自動で告知されます。",
        "각 게임과 기능에는 최소 300단어의 상세 블로그 글이 있으며 조회수와 이모지 반응이 표시됩니다. 신규 드롭과 잭팟도 자동으로 공지됩니다.",
        "لكل لعبة وميزة مقال مفصّل لا يقل عن 300 كلمة، مع عدّاد مشاهدات وتفاعلات بالرموز التعبيرية. وتُعلن الإصدارات الجديدة والجوائز هناك تلقائيًا.",
    ],
    "faq.freeQ": [
        "¿Todo esto es gratis?",
        "Tout cela est-il gratuit ?",
        "Tudo isso é gratuito?",
        "Tutto questo è gratuito?",
        "Всё это бесплатно?",
        "这一切都免费吗？",
        "これはすべて無料？",
        "이 모든 것이 무료인가요?",
        "هل كل هذا مجاني؟",
    ],
    "faq.freeA": [
        "Sí — inicia sesión con Twitch, sincroniza tus insignias y todo es jugable gratis. Sin compras, sin pay-to-win.",
        "Oui — connecte-toi avec Twitch, synchronise tes badges et tout est jouable gratuitement. Aucun achat, pas de pay-to-win.",
        "Sim — faça login com a Twitch, sincronize seus emblemas e tudo é jogável de graça. Sem compras, sem pay-to-win.",
        "Sì — accedi con Twitch, sincronizza i badge e tutto è giocabile gratuitamente. Nessun acquisto, niente pay-to-win.",
        "Да — войдите через Twitch, синхронизируйте значки, и всё доступно бесплатно. Без покупок и pay-to-win.",
        "是的——用 Twitch 登录并同步徽章，一切都能免费游玩。没有购买，也没有付费取胜。",
        "はい — Twitchでログインしてバッジを同期すれば、すべて無料で遊べます。購入もpay-to-winもありません。",
        "네 — Twitch로 로그인해 배지를 동기화하면 모두 무료로 즐길 수 있습니다. 결제도, pay-to-win도 없습니다.",
        "نعم — سجّل الدخول عبر Twitch وزامن شاراتك، وكل شيء قابل للعب مجانًا. بلا مشتريات وبلا دفع مقابل الفوز.",
    ],
    "faq.dataQ": [
        "¿De dónde vienen mis datos?",
        "D'où viennent mes données ?",
        "De onde vêm meus dados?",
        "Da dove provengono i miei dati?",
        "Откуда берутся мои данные?",
        "我的数据从哪里来？",
        "データの出典は？",
        "제 데이터는 어디에서 오나요?",
        "من أين تأتي بياناتي؟",
    ],
}

# Vendor-free replacement for every locale (also fixes en/de).
DATA_A = {
    "en": "Badges sync from the official Twitch catalog, owner statistics come from public community trackers, and the badges you own are resolved live from your public Twitch profile. BadgesCoins and XP are this site's own playful economy and have no monetary value.",
    "de": "Badges werden aus dem offiziellen Twitch-Katalog synchronisiert, Besitzer-Statistiken stammen aus öffentlichen Community-Trackern, und deine eigenen Badges werden live aus deinem öffentlichen Twitch-Profil ermittelt. BadgesCoins und XP sind die eigene spielerische Wirtschaft dieser Seite und haben keinen Geldwert.",
    "es": "Las insignias se sincronizan desde el catálogo oficial de Twitch, las estadísticas de propietarios provienen de rastreadores comunitarios públicos y las insignias que posees se resuelven en vivo desde tu perfil público de Twitch. BadgesCoins y XP son la economía lúdica propia de este sitio y no tienen valor monetario.",
    "fr": "Les badges sont synchronisés depuis le catalogue officiel de Twitch, les statistiques de propriétaires proviennent de trackers communautaires publics et les badges que tu possèdes sont résolus en direct depuis ton profil Twitch public. Les BadgesCoins et l'XP sont l'économie ludique propre à ce site et n'ont aucune valeur monétaire.",
    "pt": "Os emblemas são sincronizados do catálogo oficial da Twitch, as estatísticas de proprietários vêm de rastreadores comunitários públicos e os emblemas que você possui são resolvidos ao vivo a partir do seu perfil público da Twitch. BadgesCoins e XP são a economia lúdica deste site e não têm valor monetário.",
    "it": "I badge sono sincronizzati dal catalogo ufficiale Twitch, le statistiche sui proprietari provengono da tracker comunitari pubblici e i badge che possiedi vengono risolti in tempo reale dal tuo profilo Twitch pubblico. BadgesCoins e XP sono l'economia di gioco di questo sito e non hanno valore monetario.",
    "ru": "Значки синхронизируются из официального каталога Twitch, статистика владельцев берётся из публичных сообществ-трекеров, а ваши собственные значки определяются в реальном времени из вашего публичного профиля Twitch. BadgesCoins и XP — собственная игровая экономика этого сайта, не имеющая денежной ценности.",
    "zh": "徽章从 Twitch 官方目录同步，持有者统计来自公开的社区追踪器，你拥有的徽章则从你的公开 Twitch 个人资料实时解析。BadgesCoins 与 XP 是本站自有的娱乐性经济系统，不具备任何货币价值。",
    "ja": "バッジはTwitch公式カタログから同期され、所有者の統計は公開コミュニティトラッカーから取得し、あなたが所有するバッジは公開Twitchプロフィールからリアルタイムに判定します。BadgesCoinsとXPは当サイト独自の遊び用経済であり、金銭的価値はありません。",
    "ko": "배지는 Twitch 공식 카탈로그에서 동기화되고, 소유자 통계는 공개 커뮤니티 트래커에서 가져오며, 보유한 배지는 공개 Twitch 프로필에서 실시간으로 확인합니다. BadgesCoins와 XP는 이 사이트만의 놀이용 경제이며 금전적 가치가 없습니다.",
    "ar": "تتم مزامنة الشارات من كتالوج Twitch الرسمي، وتأتي إحصاءات المالكين من متتبعات مجتمعية عامة، أما الشارات التي تملكها فتُحدَّد مباشرة من ملفك العام على Twitch. وBadgesCoins وXP هما اقتصاد ترفيهي خاص بهذا الموقع وليس لهما أي قيمة نقدية.",
}

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def put(tree, path, value):
    parts = path.split(".")
    node = tree
    for part in parts[:-1]:
        node = node[part]
    node[parts[-1]] = value


bad = [k for k, v in FAQ.items() if len(v) != len(NINE)]
if bad:
    raise SystemExit(f"length mismatch: {bad}")

written = 0
for index, locale in enumerate(NINE):
    path = os.path.join(root, "messages", f"{locale}.json")
    with io.open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    for key, values in FAQ.items():
        put(data, key, values[index])
        written += 1
    put(data, "faq.dataA", DATA_A[locale])
    written += 1
    with io.open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"{locale}: FAQ + dataA written")

for locale in ("en", "de"):
    path = os.path.join(root, "messages", f"{locale}.json")
    with io.open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    put(data, "faq.dataA", DATA_A[locale])
    with io.open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"{locale}: vendor-free dataA written")
    written += 1

print(f"OK — {written} strings written")