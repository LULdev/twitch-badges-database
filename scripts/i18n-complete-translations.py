"""Completes the Brazilian-Portuguese... no: the missing translations (bug B1).

120 keys were English in 9 of 11 locales (es, fr, pt, it, ru, zh, ja, ko, ar) —
the whole gamification, FAQ and profile-customizer surface. Brand names
(BadgesCoins, XP, Twitch, Turbo) and the slot game title stay untouched.

Order of the value lists: es, fr, pt, it, ru, zh, ja, ko, ar
"""
import json
import io
import os

LOCALES = ["es", "fr", "pt", "it", "ru", "zh", "ja", "ko", "ar"]

TR = {
    "profile.latestVisitors": [
        "Últimas visitas", "Dernières visites", "Últimas visitas", "Ultime visite",
        "Последние посетители", "最近访客", "最近の訪問者", "최근 방문자", "أحدث الزوار",
    ],
    "profile.coinRain": [
        "Lluvia de BadgesCoins", "Pluie de BadgesCoins", "Chuva de BadgesCoins",
        "Pioggia di BadgesCoins", "Дождь BadgesCoins", "BadgesCoins 雨",
        "BadgesCoinsの雨", "BadgesCoins 비", "مطر BadgesCoins",
    ],
    "profile.coinRainHint": [
        "Regala 1 moneda a este coleccionista — una vez al día.",
        "Offre 1 pièce à ce collectionneur — une fois par jour.",
        "Presenteie este colecionador com 1 moeda — uma vez por dia.",
        "Regala 1 moneta a questo collezionista — una volta al giorno.",
        "Подарите этому коллекционеру 1 монету — раз в день.",
        "送这位收藏者 1 枚硬币——每天一次。",
        "このコレクターに1コインを贈れます（1日1回）。",
        "이 수집가에게 코인 1개를 선물하세요 — 하루 한 번.",
        "أهدِ هذا الجامع عملة واحدة — مرة واحدة يوميًا.",
    ],
    "games.hubSubtitle": [
        "13 juegos de insignias de Twitch — apuesta BadgesCoins, gana BadgesCoins, consigue XP.",
        "13 jeux de badges Twitch — misez des BadgesCoins, gagnez des BadgesCoins, gagnez de l'XP.",
        "13 jogos de emblemas da Twitch — aposte BadgesCoins, ganhe BadgesCoins, ganhe XP.",
        "13 giochi di badge Twitch — punta BadgesCoins, vinci BadgesCoins, guadagna XP.",
        "13 игр с Twitch-значками — ставьте BadgesCoins, выигрывайте BadgesCoins, получайте XP.",
        "13 款 Twitch 徽章游戏——押注 BadgesCoins，赢取 BadgesCoins，赚取 XP。",
        "Twitchバッジのゲーム13種 — BadgesCoinsを賭けてBadgesCoinsを獲得し、XPを稼ごう。",
        "Twitch 배지 게임 13종 — BadgesCoins를 걸고 BadgesCoins를 따고 XP를 획득하세요.",
        "13 لعبة شارات Twitch — راهن بـ BadgesCoins واربح BadgesCoins واكسب XP.",
    ],
    "games.currentRarity": [
        "Puntuación de rareza actual", "Score de rareté actuel", "Pontuação de raridade atual",
        "Punteggio di rarità attuale", "Текущая оценка редкости", "当前稀有度评分",
        "現在のレアリティスコア", "현재 희귀도 점수", "درجة الندرة الحالية",
    ],
    "games.hiloHint": [
        "¿La puntuación de rareza de la próxima insignia será mayor o menor? Acertar paga 1,95x.",
        "Le score de rareté du prochain badge sera-t-il plus haut ou plus bas ? Gagner paie 1,95x.",
        "A pontuação de raridade do próximo emblema será maior ou menor? Acertar paga 1,95x.",
        "Il punteggio di rarità del prossimo badge sarà più alto o più basso? Indovinare paga 1,95x.",
        "Оценка редкости следующего значка будет выше или ниже? Угадаете — выплата 1,95x.",
        "下一枚徽章的稀有度评分会更高还是更低？猜对可得 1.95 倍。",
        "次のバッジのレアリティスコアは高いか低いか？的中で1.95倍。",
        "다음 배지의 희귀도 점수가 높을까 낮을까? 맞히면 1.95배 지급.",
        "هل ستكون درجة ندرة الشارة التالية أعلى أم أدنى؟ التوقع الصحيح يمنحك 1.95 ضعفًا.",
    ],
    "games.scratchHint": [
        "Rasca los 9 campos — 3 símbolos iguales ganan. El triple jackpot paga 20x.",
        "Grattez les 9 cases — 3 symboles identiques gagnent. Le triple jackpot paie 20x.",
        "Raspe os 9 campos — 3 símbolos iguais ganham. O jackpot triplo paga 20x.",
        "Gratta i 9 campi — 3 simboli uguali vincono. Il jackpot triplo paga 20x.",
        "Сотрите 9 полей — 3 одинаковых символа выигрывают. Тройной джекпот платит 20x.",
        "刮开 9 个格子——3 个相同符号即中奖，三连头奖可得 20 倍。",
        "9マスを削る — 同じシンボル3つで当たり。トリプルジャックポットは20倍。",
        "9개 칸을 긁으세요 — 같은 심볼 3개면 당첨, 트리플 잭팟은 20배.",
        "اكشط 9 خانات — ثلاثة رموز متطابقة تفوز، والجاكبوت الثلاثي يمنح 20 ضعفًا.",
    ],
    "games.vaultHint": [
        "Detén cada aguja en la zona verde: multiplicador 0/0,5x, 1/1,5x, 2/3x, 3/3x.",
        "Arrêtez chaque aiguille dans la zone verte : multiplicateur 0/0,5x, 1/1,5x, 2/3x, 3/3x.",
        "Pare cada agulha na zona verde: multiplicador 0/0,5x, 1/1,5x, 2/3x, 3/3x.",
        "Ferma ogni ago nella zona verde: moltiplicatore 0/0,5x, 1/1,5x, 2/3x, 3/3x.",
        "Остановите каждую стрелку в зелёной зоне: множитель 0/0,5x, 1/1,5x, 2/3x, 3/3x.",
        "让每根指针停在绿色区域：倍率 0/0.5 倍、1/1.5 倍、2/3 倍、3/3 倍。",
        "各針をグリーンゾーンで止めよう：倍率 0/0.5倍、1/1.5倍、2/3倍、3/3倍。",
        "각 바늘을 초록 구역에 멈추세요: 배율 0/0.5배, 1/1.5배, 2/3배, 3/3배.",
        "أوقف كل إبرة في المنطقة الخضراء: المضاعف 0/0.5 أو 1/1.5 أو 2/3 أو 3/3.",
    ],
    "games.crashed": [
        "¡Los guardias de la torre te atraparon!",
        "Les gardes de la tour t'ont attrapé !",
        "Os guardas da torre pegaram você!",
        "Le guardie della torre ti hanno preso!",
        "Стражники башни вас поймали!",
        "塔的守卫抓住了你！",
        "塔の警備員に捕まった！",
        "탑의 경비병에게 붙잡혔습니다!",
        "أمسك بك حراس البرج!",
    ],
    "games.noWin": [
        "Sin premio — ¡gira otra vez!", "Pas de gain — relance !", "Sem prêmio — gire novamente!",
        "Nessuna vincita — gira ancora!", "Без выигрыша — крутите ещё!", "没有中奖——再转一次！",
        "ハズレ — もう一度回そう！", "당첨 없음 — 다시 돌리세요!", "لا فوز — أدر مرة أخرى!",
    ],
    "games.shootHint": [
        "Haz clic en las insignias voladoras en 30 segundos — la puntería paga, los fallos cuestan.",
        "Cliquez sur les badges volants en 30 secondes — la précision paie, les ratés coûtent.",
        "Clique nos emblemas voadores em 30 segundos — precisão paga, erros custam.",
        "Clicca sui badge volanti entro 30 secondi — la precisione paga, gli errori costano.",
        "Сбивайте летящие значки за 30 секунд — точность вознаграждается, промахи стоят.",
        "在 30 秒内点击飞行的徽章——命中得分，失误扣分。",
        "30秒以内に飛ぶバッジを撃とう — 命中は報われ、ミスは損失。",
        "30초 안에 날아다니는 배지를 클릭하세요 — 명중은 보상, 실패는 손해.",
        "انقر على الشارات الطائرة خلال 30 ثانية — الدقة تكافئ والأخطاء تكلف.",
    ],
    "games.catcherHint": [
        "Atrapa insignias con tu cesta, esquiva las bombas (-3). 30 segundos.",
        "Attrapez les badges avec votre panier, évitez les bombes (-3). 30 secondes.",
        "Pegue emblemas com sua cesta, evite as bombas (-3). 30 segundos.",
        "Cattura i badge con il cesto, evita le bombe (-3). 30 secondi.",
        "Ловите значки корзиной, уклоняйтесь от бомб (-3). 30 секунд.",
        "用篮子接住下落的徽章，避开炸弹（-3）。30 秒。",
        "カゴでバッジをキャッチ、爆弾は避けよう（-3）。30秒。",
        "바구니로 배지를 받고 폭탄은 피하세요 (-3). 30초.",
        "التقط الشارات المتساقطة في سلتك وتجنّب القنابل (-3). 30 ثانية.",
    ],
    "games.wheelLink": [
        "Ruleta de la fortuna", "Roue de la fortune", "Roleta da fortuna",
        "Ruota della fortuna", "Колесо фортуны", "命运转盘", "フォーチュンホイール",
        "운명의 수레바퀴", "عجلة الحظ",
    ],
    "games.loginRequired": [
        "Inicia sesión con Twitch para jugar — tus BadgesCoins y XP te esperan.",
        "Connecte-toi avec Twitch pour jouer — tes BadgesCoins et ton XP t'attendent.",
        "Faça login com a Twitch para jogar — seus BadgesCoins e XP esperam por você.",
        "Accedi con Twitch per giocare — i tuoi BadgesCoins e XP ti aspettano.",
        "Войдите через Twitch, чтобы играть — ваши BadgesCoins и XP ждут.",
        "使用 Twitch 登录即可游玩——你的 BadgesCoins 和 XP 正等着你。",
        "Twitchでログインしてプレイ — BadgesCoinsとXPが待っています。",
        "Twitch로 로그인하고 플레이하세요 — BadgesCoins와 XP가 기다립니다.",
        "سجّل الدخول عبر Twitch للعب — BadgesCoins وXP في انتظارك.",
    ],
    "games.dailyHint": [
        "+10 XP y +50 BadgesCoins cada día — las rachas pagan hasta +50 XP extra.",
        "+10 XP et +50 BadgesCoins chaque jour — les séries paient jusqu'à +50 XP bonus.",
        "+10 XP e +50 BadgesCoins por dia — sequências pagam até +50 XP de bônus.",
        "+10 XP e +50 BadgesCoins ogni giorno — le serie pagano fino a +50 XP extra.",
        "+10 XP и +50 BadgesCoins ежедневно — серии дают до +50 XP бонусом.",
        "每天 +10 XP 和 +50 BadgesCoins——连击最高再得 +50 XP。",
        "毎日 +10 XP と +50 BadgesCoins — 連続日数で最大 +50 XP のボーナス。",
        "매일 +10 XP와 +50 BadgesCoins — 연속 접속 시 최대 +50 XP 보너스.",
        "‎+10 XP و+50 BadgesCoins يوميًا — والتتابع يمنح حتى +50 XP إضافية.",
    ],
    "games.dailyClaim": [
        "Reclamar bono diario", "Récupérer le bonus quotidien", "Resgatar bônus diário",
        "Riscatta il bonus giornaliero", "Получить ежедневный бонус", "领取每日奖励",
        "デイリーボーナスを受け取る", "일일 보너스 받기", "استلم المكافأة اليومية",
    ],
    "games.dailyComeBack": [
        "Vuelve mañana para el próximo bono.", "Reviens demain pour le prochain bonus.",
        "Volte amanhã para o próximo bônus.", "Torna domani per il prossimo bonus.",
        "Возвращайтесь завтра за новым бонусом.", "明天再来领取下一份奖励。",
        "明日また戻って次のボーナスを受け取ろう。", "내일 다시 오셔서 다음 보너스를 받으세요.",
        "عُد غدًا للحصول على المكافأة التالية.",
    ],
    "games.rpsTitle": [
        "Piedra, papel o tijera", "Pierre-feuille-ciseaux", "Pedra, papel e tesoura",
        "Sasso, carta, forbice", "Камень, ножницы, бумага", "石头剪刀布",
        "じゃんけん", "가위바위보", "حجر ورقة مقص",
    ],
    "games.rpsDesc": [
        "El duelo clásico contra el bot. Doble o nada en cada ronda.",
        "Le duel classique contre le bot. Quitte ou double à chaque manche.",
        "O duelo clássico contra o bot. Dobro ou nada em cada rodada.",
        "Il duello classico contro il bot. Doppio o niente a ogni round.",
        "Классическая дуэль с ботом. Двойной выигрыш или ничего в каждом раунде.",
        "与机器人的经典对决。每局翻倍或归零。",
        "ボットとの定番対決。毎ラウンド倍かゼロか。",
        "봇과의 클래식 대결. 매 라운드 배수 또는 전액 잃음.",
        "المبارزة الكلاسيكية ضد الروبوت. مضاعفة أو لا شيء في كل جولة.",
    ],
    "games.slotsTitle": ["Badges of Ra 6 Deluxe"] * 9,
    "games.slotsDesc": [
        "5 rodillos, 3 filas, símbolos de insignias reales y un jackpot scatter.",
        "5 rouleaux, 3 lignes, de vrais symboles de badges et un jackpot scatter.",
        "5 rolos, 3 linhas, símbolos reais de emblemas e um jackpot scatter.",
        "5 rulli, 3 righe, veri simboli badge e un jackpot scatter.",
        "5 барабанов, 3 ряда, настоящие символы значков и скаттер-джекпот.",
        "5 个转轴、3 行，真实的徽章符号与散射头奖。",
        "5リール・3列、本物のバッジシンボルとスキャッタージャックポット。",
        "5개 릴, 3개 행, 실제 배지 심볼과 스캐터 잭팟.",
        "5 بكرات و3 صفوف ورموز شارات حقيقية وجاكبوت مبعثر.",
    ],
    "games.shootTitle": ["Shoot the Badges"] * 9,
    "games.shootDesc": [
        "Estilo Moorhuhn: acierta tantas insignias voladoras como puedas en 30 segundos.",
        "Style Moorhuhn : abats un maximum de badges volants en 30 secondes.",
        "Estilo Moorhuhn: acerte o máximo de emblemas voadores em 30 segundos.",
        "Stile Moorhuhn: colpisci più badge volanti che puoi in 30 secondi.",
        "В стиле Moorhuhn: сбейте как можно больше летящих значков за 30 секунд.",
        "Moorhuhn 风格：30 秒内尽可能多地命飞行的徽章。",
        "モールフーン風：30秒で飛ぶバッジをできるだけ撃ち落とそう。",
        "Moorhuhn 스타일: 30초 동안 날아다니는 배지를 최대한 맞히세요.",
        "على طريقة Moorhuhn: أصب أكبر عدد من الشارات الطائرة خلال 30 ثانية.",
    ],
    "games.memoryDesc": [
        "Encuentra las seis parejas de insignias — las partidas rápidas y sin errores pagan mejor.",
        "Trouve les six paires de badges — les parties rapides et sans erreur rapportent le plus.",
        "Encontre os seis pares de emblemas — rodadas rápidas e sem erros pagam melhor.",
        "Trova le sei coppie di badge — le partite veloci e senza errori pagano meglio.",
        "Найдите шесть пар значков — быстрые раунды без ошибок платят больше.",
        "找出六对徽章——越快越少失误，奖励越高。",
        "6組のバッジペアを探そう — 速くミスの少ないほど高報酬。",
        "배지 6쌍을 찾으세요 — 빠르고 실수 없이 끝낼수록 보상이 큽니다.",
        "اعثر على أزواج الشارات الستة — الجولات السريعة بلا أخطاء تدفع أكثر.",
    ],
    "games.quizDesc": [
        "¿Qué insignia es esta? Diez preguntas, cuatro opciones, puro conocimiento de insignias.",
        "Quel est ce badge ? Dix questions, quatre options, pure connaissance des badges.",
        "Qual é este emblema? Dez perguntas, quatro opções, puro conhecimento de emblemas.",
        "Quale badge è questo? Dieci domande, quattro opzioni, pura conoscenza dei badge.",
        "Что это за значок? Десять вопросов, четыре варианта, чистое знание значков.",
        "这是哪枚徽章？十道题、四个选项，纯徽章知识。",
        "このバッジはどれ？全10問・4択、バッジ知識の真剣勝負。",
        "이 배지는 무엇일까요? 10문제, 4개 선택지, 순수 배지 지식 대결.",
        "ما هذه الشارة؟ عشرة أسئلة وأربعة خيارات واختبار معرفة خالص بالشارات.",
    ],
    "games.coinflipTitle": [
        "Escalera de BadgesCoins", "Échelle de BadgesCoins", "Escada de BadgesCoins",
        "Scala di BadgesCoins", "Лестница BadgesCoins", "BadgesCoins 阶梯",
        "BadgesCoinsラダー", "BadgesCoins 사다리", "سلّم BadgesCoins",
    ],
    "games.coinflipDesc": [
        "Cara o cruz en una escalera de 7 pasos — cada paso duplica la ganancia.",
        "Pile ou face sur une échelle de 7 marches — chaque marche double le gain.",
        "Cara ou coroa em uma escada de 7 degraus — cada degrau dobra o prêmio.",
        "Testa o croce su una scala di 7 gradini — ogni gradino raddoppia la vincita.",
        "Орёл или решка на лестнице из 7 ступеней — каждая ступень удваивает выигрыш.",
        "在 7 级阶梯上猜正反面——每上一级奖金翻倍。",
        "7段のはしごで表か裏か — 1段ごとに賞金が倍に。",
        "7단계 사다리에서 앞면 또는 뒷면 — 한 단계마다 상금이 두 배.",
        "صورة أو كتابة على سلّم من 7 درجات — كل درجة تضاعف الجائزة.",
    ],
    "games.hiloTitle": [
        "Mayor o menor", "Plus haut ou plus bas", "Maior ou menor",
        "Più alto o più basso", "Выше или ниже", "更高或更低",
        "ハイアー・オア・ロウアー", "높음 또는 낮음", "أعلى أم أدنى",
    ],
    "games.hiloDesc": [
        "Apuesta a la puntuación de rareza de la próxima insignia — 1,95x por acierto.",
        "Misez sur le score de rareté du prochain badge — 1,95x par bonne réponse.",
        "Aposte na pontuação de raridade do próximo emblema — 1,95x por acerto.",
        "Punta sul punteggio di rarità del prossimo badge — 1,95x per risposta corretta.",
        "Ставьте на оценку редкости следующего значка — 1,95x за верный прогноз.",
        "押注下一枚徽章的稀有度评分——猜对得 1.95 倍。",
        "次のバッジのレアリティスコアに賭けよう — 的中で1.95倍。",
        "다음 배지의 희귀도 점수에 베팅하세요 — 맞히면 1.95배.",
        "راهن على درجة ندرة الشارة التالية — 1.95 ضعف لكل توقع صحيح.",
    ],
    "games.rouletteDesc": [
        "Rojo, negro o el cero verde a 14x. 37 casillas, puro suspense.",
        "Rouge, noir ou le zéro vert à 14x. 37 cases, pur suspense.",
        "Vermelho, preto ou o zero verde a 14x. 37 casas, puro suspense.",
        "Rosso, nero o lo zero verde a 14x. 37 caselle, pura suspense.",
        "Красное, чёрное или зелёный ноль за 14x. 37 ячеек, чистое напряжение.",
        "红、黑或绿色零，14 倍赔率。37 个格子，悬念十足。",
        "赤・黒・緑のゼロは14倍。37ポケットの緊張感。",
        "빨강, 검정 또는 초록 제로는 14배. 37개 칸의 긴장감.",
        "أحمر أو أسود أو الصفر الأخضر بـ14 ضعفًا. 37 جيبًا من التشويق.",
    ],
    "games.blackjackTitle": ["Badge Blackjack"] * 9,
    "games.blackjackDesc": [
        "21 contra el crupier — elige tu estrategia y reparte.",
        "21 contre le croupier — choisis ta stratégie et distribue.",
        "21 contra o crupiê — escolha sua estratégia e distribua.",
        "21 contro il banco — scegli la strategia e distribuisci.",
        "21 против дилера — выберите стратегию и раздайте.",
        "与庄家比 21 点——选择你的策略并发牌。",
        "ディーラー相手に21 — 戦略を選んで配ろう。",
        "딜러와의 21 — 전략을 고르고 카드를 받으세요.",
        "21 ضد الموزّع — اختر استراتيجيتك ووزّع البطاقات.",
    ],
    "games.vaultTitle": [
        "Abrir la caja fuerte", "Crocheter le coffre", "Arrombar o cofre",
        "Forzare la cassaforte", "Взломать сейф", "破解保险箱",
        "金庫破り", "금고 해제", "كسر الخزنة",
    ],
    "games.vaultDesc": [
        "Detén tres agujas en la zona verde. Tres paradas perfectas = 3x.",
        "Arrête trois aiguilles dans la zone verte. Trois arrêts parfaits = 3x.",
        "Pare três agulhas na zona verde. Três paradas perfeitas = 3x.",
        "Ferma tre aghi nella zona verde. Tre stop perfetti = 3x.",
        "Остановите три стрелки в зелёной зоне. Три идеальных стопа = 3x.",
        "让三根指针停在绿色区域。三次完美停针 = 3 倍。",
        "3本の針をグリーンゾーンで止めよう。3回パーフェクトで3倍。",
        "바늘 3개를 초록 구역에 멈추세요. 3번 완벽하면 3배.",
        "أوقف ثلاث إبر في المنطقة الخضراء. ثلاث وقفات مثالية = 3 أضعاف.",
    ],
    "games.scratchTitle": ["Scratch the Badge"] * 9,
    "games.scratchDesc": [
        "Rasca nueve campos — tres símbolos iguales ganan hasta 20x.",
        "Grattez neuf cases — trois symboles identiques gagnent jusqu'à 20x.",
        "Raspe nove campos — três símbolos iguais ganham até 20x.",
        "Gratta nove campi — tre simboli uguali vincono fino a 20x.",
        "Сотрите девять полей — три одинаковых символа дают до 20x.",
        "刮开九个格子——三个相同符号最高赢 20 倍。",
        "9マスを削る — 同じシンボル3つで最大20倍。",
        "9개 칸을 긁으세요 — 같은 심볼 3개면 최대 20배.",
        "اكشط تسع خانات — ثلاثة رموز متطابقة تمنح حتى 20 ضعفًا.",
    ],
    "games.towerTitle": [
        "Torre de insignias", "Tour des badges", "Torre de emblemas",
        "Torre dei badge", "Башня значков", "徽章之塔", "バッジの塔",
        "배지의 탑", "برج الشارات",
    ],
    "games.towerDesc": [
        "Sube diez pisos de riesgo creciente — retírate antes de que te atrapen los guardias.",
        "Monte dix étages au risque croissant — encaisse avant que les gardes ne t'attrapent.",
        "Suba dez andares de risco crescente — saque antes que os guardas peguem você.",
        "Sali dieci piani di rischio crescente — incassa prima che le guardie ti prendano.",
        "Поднимитесь на десять этажей растущего риска — заберите выигрыш до того, как вас поймают.",
        "攀爬十层，风险递增——在被守卫抓住前及时兑现。",
        "リスクが増す10階を登る — 警備員に捕まる前にキャッシュアウト。",
        "위험이 커지는 10개 층을 오르세요 — 경비병에게 붙잡히기 전에 정산하세요.",
        "اصعد عشرة طوابق يتزايد خطرها — اسحب أرباحك قبل أن يمسك بك الحراس.",
    ],
    "games.catcherDesc": [
        "Atrapa insignias que caen en tu cesta, esquiva las bombas.",
        "Attrapez les badges qui tombent dans votre panier, évitez les bombes.",
        "Pegue emblemas que caem na sua cesta, evite as bombas.",
        "Cattura i badge che cadono nel cesto, evita le bombe.",
        "Ловите падающие значки корзиной, уклоняйтесь от бомб.",
        "用篮子接住下落的徽章，避开炸弹。",
        "落ちてくるバッジをカゴで受け、爆弾は避けよう。",
        "떨어지는 배지를 바구니로 받고 폭탄은 피하세요.",
        "التقط الشارات المتساقطة في سلتك وتجنّب القنابل.",
    ],
    "wheel.title": [
        "Ruleta de la fortuna", "Roue de la fortune", "Roleta da fortuna",
        "Ruota della fortuna", "Колесо фортуны", "命运转盘", "フォーチュンホイール",
        "운명의 수레바퀴", "عجلة الحظ",
    ],
    "wheel.subtitle": [
        "Un giro gratis al día: de 25 a 2.500 XP más BadgesCoins — y un jackpot de Twitch Turbo a 1 : 100.000.000.",
        "Un tour gratuit par jour : de 25 à 2 500 XP plus des BadgesCoins — et un jackpot Twitch Turbo à 1 : 100 000 000.",
        "Um giro grátis por dia: de 25 a 2.500 XP mais BadgesCoins — e um jackpot de Twitch Turbo a 1 : 100.000.000.",
        "Un giro gratis al giorno: da 25 a 2.500 XP più BadgesCoins — e un jackpot Twitch Turbo a 1 : 100.000.000.",
        "Одно бесплатное вращение в день: от 25 до 2 500 XP плюс BadgesCoins — и джекпот Twitch Turbo с шансом 1 : 100 000 000.",
        "每天一次免费旋转：25 至 2,500 XP 外加 BadgesCoins——还有 1 : 100,000,000 的 Twitch Turbo 头奖。",
        "1日1回無料で回せる：25〜2,500 XPとBadgesCoins、さらに1:100,000,000のTwitch Turboジャックポット。",
        "하루 한 번 무료 회전: 25~2,500 XP와 BadgesCoins — 그리고 1 : 100,000,000 확률의 Twitch Turbo 잭팟.",
        "دورة مجانية واحدة يوميًا: من 25 إلى 2,500 XP مع BadgesCoins — وجاكبوت Twitch Turbo باحتمال 1 : 100,000,000.",
    ],
    "wheel.already": [
        "Ya giraste hoy — ¡vuelve mañana!", "Tu as déjà tourné aujourd'hui — reviens demain !",
        "Você já girou hoje — volte amanhã!", "Hai già girato oggi — torna domani!",
        "Вы уже крутили сегодня — возвращайтесь завтра!", "你今天已经转过了——明天再来！",
        "今日はもう回しました — また明日！", "오늘은 이미 돌렸습니다 — 내일 다시 오세요!",
        "لقد أدرت العجلة اليوم — عُد غدًا!",
    ],
    "wheel.turboWon": [
        "¡Una suscripción completa a Twitch Turbo es tuya!",
        "Un abonnement Twitch Turbo complet est à toi !",
        "Uma assinatura completa do Twitch Turbo é sua!",
        "Un abbonamento Twitch Turbo completo è tuo!",
        "Полная подписка Twitch Turbo — ваша!",
        "一份完整的 Twitch Turbo 订阅归你了！",
        "Twitch Turboのフル定期購読を獲得！",
        "Twitch Turbo 정기 구독권이 당신 것입니다!",
        "اشتراك Twitch Turbo كامل لك!",
    ],
    "wheel.turboOdds": [
        "Casilla bono: suscripción a Twitch Turbo. Probabilidad 0,00000001 (1 : 100.000.000).",
        "Case bonus : abonnement Twitch Turbo. Probabilité 0,00000001 (1 : 100 000 000).",
        "Casa bônus: assinatura do Twitch Turbo. Probabilidade 0,00000001 (1 : 100.000.000).",
        "Slot bonus: abbonamento Twitch Turbo. Probabilità 0,00000001 (1 : 100.000.000).",
        "Бонусный слот: подписка Twitch Turbo. Вероятность 0,00000001 (1 : 100 000 000).",
        "奖励格：Twitch Turbo 订阅。中奖概率 0.00000001（1 : 100,000,000）。",
        "ボーナス枠：Twitch Turbo定期購読。確率 0.00000001（1 : 100,000,000）。",
        "보너스 칸: Twitch Turbo 구독. 확률 0.00000001 (1 : 100,000,000).",
        "خانة إضافية: اشتراك Twitch Turbo. الاحتمال 0.00000001 (1 : 100,000,000).",
    ],
    "feed.title": [
        "Feed de actividad en vivo", "Fil d'activité en direct", "Feed de atividade ao vivo",
        "Feed attività in diretta", "Лента активности в реальном времени", "实时活动动态",
        "ライブアクティビティフィード", "실시간 활동 피드", "خلاصة النشاط المباشر",
    ],
    "feed.subtitle": [
        "Cada XP ganado, partida, logro y robo de todos los coleccionistas — en tiempo real.",
        "Chaque XP gagné, partie, succès et vol de tous les collectionneurs — en temps réel.",
        "Cada XP ganho, partida, conquista e roubo de todos os colecionadores — em tempo real.",
        "Ogni XP guadagnato, partita, obiettivo e furto di tutti i collezionisti — in tempo reale.",
        "Каждый заработанный XP, игра, достижение и кража у всех коллекционеров — в реальном времени.",
        "所有收藏者的每一次 XP 变动、对局、成就与偷取——实时呈现。",
        "全コレクターのXP獲得・ゲーム・実績・盗みをリアルタイム表示。",
        "모든 수집가의 XP 획득, 게임, 업적, 훔치기를 실시간으로.",
        "كل XP مكتسب وكل لعبة وإنجاز وسرقة لدى جميع الجامعين — في الوقت الحقيقي.",
    ],
    "feed.empty": [
        "Aún no hay actividad — ¡sé el primero!",
        "Pas encore d'activité — sois le premier !",
        "Ainda sem atividade — seja o primeiro!",
        "Ancora nessuna attività — sii il primo!",
        "Активности пока нет — будьте первым!",
        "还没有活动——来当第一个吧！",
        "まだアクティビティがありません — 最初の一人になろう！",
        "아직 활동이 없습니다 — 첫 번째가 되어보세요!",
        "لا يوجد نشاط بعد — كن الأول!",
    ],
    "feed.coin_rain": [
        "Lluvia de BadgesCoins", "Pluie de BadgesCoins", "Chuva de BadgesCoins",
        "Pioggia di BadgesCoins", "Дождь BadgesCoins", "BadgesCoins 雨",
        "BadgesCoinsの雨", "BadgesCoins 비", "مطر BadgesCoins",
    ],
    "achievements.subtitle": [
        "125 logros que cazar — 50 comunes, 50 creativos, 25 realmente inesperados.",
        "125 succès à chasser — 50 communs, 50 créatifs, 25 vraiment inattendus.",
        "125 conquistas para caçar — 50 comuns, 50 criativas, 25 realmente inesperadas.",
        "125 obiettivi da cacciare — 50 comuni, 50 creativi, 25 davvero inaspettati.",
        "125 достижений для охоты — 50 обычных, 50 творческих, 25 действительно неожиданных.",
        "125 个待解锁的成就——50 个普通、50 个创意、25 个真正意想不到的。",
        "追いかける実績は125種 — コモン50、クリエイティブ50、まさかのスペシャル25。",
        "사냥할 업적 125개 — 일반 50, 창의 50, 진짜 예상 밖의 특별 25.",
        "125 إنجازًا لاصطيادها — 50 عادية و50 إبداعية و25 مفاجئة حقًا.",
    ],
    "achievements.loginHint": [
        "Inicia sesión para seguir tu progreso de logros.",
        "Connecte-toi pour suivre ta progression de succès.",
        "Faça login para acompanhar seu progresso de conquistas.",
        "Accedi per seguire i tuoi progressi negli obiettivi.",
        "Войдите, чтобы отслеживать прогресс достижений.",
        "登录以追踪你的成就进度。",
        "ログインして実績の進捗を確認しよう。",
        "로그인하여 업적 진행 상황을 확인하세요.",
        "سجّل الدخول لتتبع تقدمك في الإنجازات.",
    ],
    "steal.hint": [
        "El intento cuesta {price} BadgesCoins (pagados a la víctima si fallas). Botín máximo: {max} BadgesCoins. La probabilidad depende de la diferencia de nivel.",
        "La tentative coûte {price} BadgesCoins (versés à la victime en cas d'échec). Butin maximal : {max} BadgesCoins. La probabilité dépend de l'écart de niveau.",
        "A tentativa custa {price} BadgesCoins (pagos à vítima em caso de falha). Saque máximo: {max} BadgesCoins. A chance depende da diferença de nível.",
        "Il tentativo costa {price} BadgesCoins (pagati alla vittima se fallisci). Bottino massimo: {max} BadgesCoins. La probabilità dipende dal divario di livello.",
        "Попытка стоит {price} BadgesCoins (при провале уходят жертве). Максимум: {max} BadgesCoins. Шанс зависит от разницы уровней.",
        "每次尝试花费 {price} BadgesCoins（失败时归受害者所有）。最大收获：{max} BadgesCoins。成功率取决于等级差。",
        "試行には{price} BadgesCoinsが必要（失敗時は相手に支払われる）。最大獲得：{max} BadgesCoins。成功率はレベル差で変動。",
        "시도 비용은 {price} BadgesCoins (실패 시 상대에게 지급). 최대 습득: {max} BadgesCoins. 성공률은 레벨 차이에 따라 달라집니다.",
        "تكلّف المحاولة {price} BadgesCoins (تُدفع للضحية عند الفشل). أقصى غنيمة: {max} BadgesCoins. الاحتمال يعتمد على فرق المستوى.",
    ],
    "steal.success": [
        "¡Golpe exitoso: +{coins} BadgesCoins!",
        "Coup réussi : +{coins} BadgesCoins !",
        "Golpe bem-sucedido: +{coins} BadgesCoins!",
        "Colpo riuscito: +{coins} BadgesCoins!",
        "Ограбление удалось: +{coins} BadgesCoins!",
        "得手：+{coins} BadgesCoins！",
        "強奪成功：+{coins} BadgesCoins！",
        "강탈 성공: +{coins} BadgesCoins!",
        "نجحت السرقة: ‎+{coins} BadgesCoins!",
    ],
    "steal.failed": [
        "¡Defendido! El intento te costó {coins} BadgesCoins.",
        "Défendu ! La tentative t'a coûté {coins} BadgesCoins.",
        "Defendido! A tentativa custou {coins} BadgesCoins.",
        "Difeso! Il tentativo ti è costato {coins} BadgesCoins.",
        "Отбито! Попытка стоила вам {coins} BadgesCoins.",
        "防守成功！这次尝试花掉了你 {coins} BadgesCoins。",
        "防衛成功！試行で{coins} BadgesCoinsを失った。",
        "방어 성공! 시도로 {coins} BadgesCoins를 잃었습니다.",
        "تم الصد! كلّفتك المحاولة {coins} BadgesCoins.",
    ],
}

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
english = json.load(io.open(os.path.join(root, "messages", "en.json"), encoding="utf-8"))


def get(tree, path):
    node = tree
    for part in path.split("."):
        node = node[part]
    return node


def put(tree, path, value):
    parts = path.split(".")
    node = tree
    for part in parts[:-1]:
        node = node[part]
    node[parts[-1]] = value


missing = [k for k, v in TR.items() if len(v) != len(LOCALES)]
if missing:
    raise SystemExit(f"length mismatch: {missing}")

# Every key must exist in English, and the ICU placeholders must survive.
for key, values in TR.items():
    source = get(english, key)
    for value in values:
        for token in ("{coins}", "{price}", "{max}"):
            if token in source and token not in value:
                raise SystemExit(f"{key}: translation lost {token}")

written = 0
for index, locale in enumerate(LOCALES):
    path = os.path.join(root, "messages", f"{locale}.json")
    with io.open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    for key, values in TR.items():
        put(data, key, values[index])
        written += 1
    with io.open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"{locale}: {len(TR)} keys translated")

print(f"OK — {written} strings translated across {len(LOCALES)} locales")