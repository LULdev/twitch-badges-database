"""Fills the remaining short label gaps (bug B1, part 4).

111 short UI labels were still English in the nine locales — the earlier audit
missed them because of a length filter. German arbitrates which keys are
translatable (it is fully localised), so this list is exactly the set where a
translation exists and the others lacked it.

Value order: es, fr, pt, it, ru, zh, ja, ko, ar
"""

# One-off migration: already applied. Re-running it would revert later
# corrections — this file's values are a snapshot of a past state of
# messages/*.json (see bugreports/verify-round20.md for the specifics). Set
# ALLOW_ONE_OFF_MIGRATION=1 to run it deliberately.
import os as _guard_os

if _guard_os.environ.get("ALLOW_ONE_OFF_MIGRATION") != "1":
    raise SystemExit(
        "Refusing to re-run: this is a one-off migration and its values are a "
        "snapshot of a past state. Set ALLOW_ONE_OFF_MIGRATION=1 to override."
    )
import json
import io
import os

LOCALES = ["es", "fr", "pt", "it", "ru", "zh", "ja", "ko", "ar"]

TR = {
    "account.notificationsSection": ["Notificaciones", "Notifications", "Notificações", "Notifiche", "Уведомления", "通知", "通知", "알림", "الإشعارات"],
    "achievements.common": ["Comunes", "Communs", "Comuns", "Comuni", "Обычные", "普通", "コモン", "일반", "عادية"],
    "achievements.creative": ["Creativos", "Créatifs", "Criativas", "Creativi", "Творческие", "创意", "クリエイティブ", "창의", "إبداعية"],
    "achievements.points": ["Puntos", "Points", "Pontos", "Punti", "Очки", "积分", "ポイント", "포인트", "نقاط"],
    "achievements.special": ["Especiales", "Spéciaux", "Especiais", "Speciali", "Особые", "特殊", "スペシャル", "특별", "خاصة"],
    "achievements.title": ["Logros", "Succès", "Conquistas", "Obiettivi", "Достижения", "成就", "実績", "업적", "الإنجازات"],
    "achievements.unlocked": ["Desbloqueado", "Débloqué", "Desbloqueada", "Sbloccato", "Открыто", "已解锁", "解除済み", "해금됨", "مفتوح"],
    "blog.react": ["Reaccionar", "Réagir", "Reagir", "Reagisci", "Реагировать", "互动", "リアクション", "반응", "تفاعل"],
    "changelog.push": ["Notificaciones", "Notifications", "Notificações", "Notifiche", "Уведомления", "通知", "通知", "알림", "الإشعارات"],
    "common.days": ["d", "j", "d", "g", "д", "天", "日", "일", "ي"],
    "common.hours": ["h", "h", "h", "h", "ч", "时", "時", "시간", "س"],
    "common.minutes": ["min", "min", "min", "min", "мин", "分", "分", "분", "د"],
    "countdown.minutes": ["min", "min", "min", "min", "мин", "分", "分", "분", "د"],
    "countdown.seconds": ["seg", "sec", "seg", "sec", "сек", "秒", "秒", "초", "ث"],
    "customizer.accent2": ["Segundo acento", "Second accent", "Segundo destaque", "Secondo accento", "Второй акцент", "第二强调色", "2つ目のアクセント", "두 번째 강조색", "اللون المميز الثاني"],
    "customizer.aura": ["Aura", "Aura", "Aura", "Aura", "Аура", "光环", "オーラ", "오라", "هالة"],
    "customizer.avatarFrame": ["Marco del avatar", "Cadre d'avatar", "Moldura do avatar", "Cornice avatar", "Рамка аватара", "头像边框", "アバターフレーム", "아바타 프레임", "إطار الصورة الرمزية"],
    "customizer.bannerOverlay": ["Capa del banner", "Superposition de bannière", "Sobreposição do banner", "Sovrapposizione banner", "Наложение на баннер", "横幅叠加层", "バナーオーバーレイ", "배너 오버레이", "طبقة فوق اللافتة"],
    "customizer.cardStyle": ["Estilo de tarjeta", "Style de carte", "Estilo do cartão", "Stile scheda", "Стиль карточки", "卡片样式", "カードスタイル", "카드 스타일", "نمط البطاقة"],
    "customizer.color": ["Color del perfil", "Couleur du profil", "Cor do perfil", "Colore profilo", "Цвет профиля", "主页颜色", "プロフィールカラー", "프로필 색상", "لون الملف"],
    "customizer.cursorBadge": ["Cursor de insignia", "Curseur badge", "Cursor de emblema", "Cursore badge", "Курсор-значок", "徽章光标", "バッジカーソル", "배지 커서", "مؤشر الشارة"],
    "customizer.density": ["Densidad del diseño", "Densité de mise en page", "Densidade do layout", "Densità layout", "Плотность макета", "布局密度", "レイアウト密度", "레이아웃 밀도", "كثافة التخطيط"],
    "customizer.displayName": ["Nombre visible", "Nom affiché", "Nome de exibição", "Nome visualizzato", "Отображаемое имя", "显示名称", "表示名", "표시 이름", "الاسم المعروض"],
    "customizer.font": ["Fuente", "Police", "Fonte", "Font", "Шрифт", "字体", "フォント", "글꼴", "الخط"],
    "customizer.moodSection": ["Estado de ánimo", "Statut d'humeur", "Status de humor", "Stato d'animo", "Настроение", "心情状态", "気分ステータス", "기분 상태", "حالة المزاج"],
    "customizer.profileTheme": ["Tema del perfil", "Thème du profil", "Tema do perfil", "Tema profilo", "Тема профиля", "主页主题", "プロフィールテーマ", "프로필 테마", "سمة الملف"],
    "customizer.radius": ["Radio de esquinas", "Rayon des coins", "Raio dos cantos", "Raggio angoli", "Радиус углов", "圆角半径", "角の丸み", "모서리 반경", "نصف قطر الزوايا"],
    "customizer.save": ["Guardar cambios", "Enregistrer", "Salvar alterações", "Salva modifiche", "Сохранить", "保存更改", "変更を保存", "변경 저장", "حفظ التغييرات"],
    "customizer.saved": ["¡Guardado!", "Enregistré !", "Salvo!", "Salvato!", "Сохранено!", "已保存！", "保存しました！", "저장됨!", "تم الحفظ!"],
    "customizer.saving": ["Guardando…", "Enregistrement…", "Salvando…", "Salvataggio…", "Сохранение…", "保存中…", "保存中…", "저장 중…", "جارٍ الحفظ…"],
    "customizer.showInventory": ["Mostrar inventario", "Afficher l'inventaire", "Mostrar inventário", "Mostra inventario", "Показывать инвентарь", "显示库存", "インベントリを表示", "인벤토리 표시", "إظهار المقتنيات"],
    "customizer.showLevel": ["Mostrar barra de nivel", "Afficher la barre de niveau", "Mostrar barra de nível", "Mostra barra livello", "Показывать шкалу уровня", "显示等级条", "レベルバーを表示", "레벨 바 표시", "إظهار شريط المستوى"],
    "customizer.showStats": ["Mostrar estadísticas", "Afficher les stats", "Mostrar estatísticas", "Mostra statistiche", "Показывать статистику", "显示统计", "統計を表示", "통계 표시", "إظهار الإحصاءات"],
    "customizer.showVisitors": ["Mostrar visitantes", "Afficher les visiteurs", "Mostrar visitantes", "Mostra visitatori", "Показывать посетителей", "显示访客", "訪問者を表示", "방문자 표시", "إظهار الزوار"],
    "customizer.stealSection": ["Ajustes de robo", "Réglages de vol", "Ajustes de roubo", "Impostazioni furti", "Настройки кражи", "偷取设置", "強奪設定", "강탈 설정", "إعدادات السرقة"],
    "feed.achievement": ["Logro", "Succès", "Conquista", "Obiettivo", "Достижение", "成就", "実績", "업적", "إنجاز"],
    "feed.anonymous": ["Alguien", "Quelqu'un", "Alguém", "Qualcuno", "Кто-то", "某人", "誰か", "누군가", "شخص ما"],
    "feed.badge_claim": ["Insignia desbloqueada", "Badge débloqué", "Emblema desbloqueado", "Badge sbloccato", "Значок открыт", "徽章已解锁", "バッジ解除", "배지 해금", "شارة مفتوحة"],
    "feed.daily": ["Bono diario", "Bonus quotidien", "Bônus diário", "Bonus giornaliero", "Ежедневный бонус", "每日奖励", "デイリーボーナス", "일일 보너스", "المكافأة اليومية"],
    "feed.first_login": ["Primer inicio de sesión", "Première connexion", "Primeiro login", "Primo accesso", "Первый вход", "首次登录", "初回ログイン", "첫 로그인", "أول تسجيل دخول"],
    "feed.game": ["Juego", "Jeu", "Jogo", "Gioco", "Игра", "游戏", "ゲーム", "게임", "لعبة"],
    "feed.level_up": ["Subida de nivel", "Montée de niveau", "Subiu de nível", "Salita di livello", "Новый уровень", "升级", "レベルアップ", "레벨 업", "ارتفاع المستوى"],
    "feed.paused": ["Pausado", "En pause", "Pausado", "In pausa", "Пауза", "已暂停", "一時停止", "일시정지", "متوقف مؤقتًا"],
    "feed.profile": ["Perfil", "Profil", "Perfil", "Profilo", "Профиль", "主页", "プロフィール", "프로필", "الملف"],
    "feed.resume": ["Reanudar", "Reprendre", "Retomar", "Riprendi", "Продолжить", "继续", "再開", "재개", "استئناف"],
    "feed.steal": ["Robo", "Vol", "Roubo", "Furto", "Кража", "偷取", "強奪", "강탈", "سرقة"],
    "feed.steal_defended": ["Defendido", "Défendu", "Defendido", "Difeso", "Отбито", "防守成功", "防衛成功", "방어 성공", "تم الصد"],
    "feed.turbo_win": ["Jackpot Turbo", "Jackpot Turbo", "Jackpot Turbo", "Jackpot Turbo", "Джекпот Turbo", "Turbo 头奖", "Turboジャックポット", "Turbo 잭팟", "جاكبوت Turbo"],
    "feed.wheel": ["Ruleta", "Roue", "Roleta", "Ruota", "Колесо", "转盘", "ホイール", "수레바퀴", "العجلة"],
    "footer.account": ["Cuenta", "Compte", "Conta", "Account", "Аккаунт", "账户", "アカウント", "계정", "الحساب"],
    "games.again": ["Jugar otra vez", "Rejouer", "Jogar novamente", "Gioca ancora", "Играть снова", "再玩一次", "もう一度プレイ", "다시 플레이", "العب مرة أخرى"],
    "games.bet": ["Apuesta", "Mise", "Aposta", "Puntata", "Ставка", "押注", "ベット", "베팅", "الرهان"],
    "games.black": ["Negro", "Noir", "Preto", "Nero", "Чёрное", "黑", "黒", "검정", "أسود"],
    "games.blackjackTitle": ["Blackjack de insignias", "Blackjack de badges", "Blackjack de emblemas", "Blackjack dei badge", "Блэкджек со значками", "徽章 21 点", "バッジブラックジャック", "배지 블랙잭", "بلاك جاك الشارات"],
    "games.cashout": ["Cobrar", "Encaisser", "Sacar", "Incassa", "Забрать", "兑现", "キャッシュアウト", "정산", "اسحب"],
    "games.cashoutAt": ["Cobrar en", "Encaisser à", "Sacar em", "Incassa a", "Забрать на", "兑现于", "キャッシュアウト：", "정산 지점", "اسحب عند"],
    "games.catcherTitle": ["Atrapa insignias", "Attrape-badges", "Pega emblemas", "Cattura badge", "Ловец значков", "接徽章", "バッジキャッチャー", "배지 캐처", "ملتقط الشارات"],
    "games.climb": ["Subir", "Monter", "Subir", "Sali", "Подняться", "攀爬", "登る", "오르기", "اصعد"],
    "games.correct": ["Correcto", "Correct", "Correto", "Corretto", "Верно", "正确", "正解", "정답", "صحيح"],
    "games.dailyDone": ["Reclamado hoy", "Récupéré aujourd'hui", "Resgatado hoje", "Riscattato oggi", "Получено сегодня", "今日已领取", "本日受取済み", "오늘 수령함", "استُلم اليوم"],
    "games.dailyTitle": ["Bono diario", "Bonus quotidien", "Bônus diário", "Bonus giornaliero", "Ежедневный бонус", "每日奖励", "デイリーボーナス", "일일 보너스", "المكافأة اليومية"],
    "games.deal": ["Repartir", "Distribuer", "Distribuir", "Distribuisci", "Раздать", "发牌", "配る", "카드 받기", "وزّع"],
    "games.flip": ["Lanzar", "Lancer", "Lançar", "Lancia", "Бросить", "抛起", "投げる", "던지기", "ارمِ"],
    "games.floor": ["Piso", "Étage", "Andar", "Piano", "Этаж", "层", "階", "층", "طابق"],
    "games.green": ["Verde", "Vert", "Verde", "Verde", "Зелёное", "绿", "緑", "초록", "أخضر"],
    "games.heads": ["Cara", "Pile", "Cara", "Testa", "Орёл", "正面", "表", "앞면", "صورة"],
    "games.higher": ["Mayor", "Plus haut", "Maior", "Più alto", "Выше", "更高", "ハイ", "높음", "أعلى"],
    "games.hubTitle": ["Sala de juegos", "Salle d'arcade", "Sala de jogos", "Sala giochi", "Игровой зал", "街机厅", "アーケード", "아케이드", "قاعة الألعاب"],
    "games.ladderTarget": ["Objetivo de la escalera", "Objectif de l'échelle", "Meta da escada", "Obiettivo scala", "Цель лестницы", "阶梯目标", "ラダーの目標", "사다리 목표", "هدف السلّم"],
    "games.lower": ["Menor", "Plus bas", "Menor", "Più basso", "Ниже", "更低", "ロー", "낮음", "أدنى"],
    "games.luck": ["Suerte", "Chance", "Sorte", "Fortuna", "Удача", "运气", "運", "운", "حظ"],
    "games.memoryTitle": ["Memoria de insignias", "Memory des badges", "Memória de emblemas", "Memory dei badge", "Память значков", "徽章记忆", "バッジメモリー", "배지 메모리", "ذاكرة الشارات"],
    "games.misses": ["Fallos", "Ratés", "Erros", "Errori", "Промахи", "失误", "ミス", "실패", "أخطاء"],
    "games.newCard": ["Nueva carta", "Nouvelle carte", "Nova carta", "Nuova carta", "Новая карта", "新牌", "新しいカード", "새 카드", "بطاقة جديدة"],
    "games.paper": ["Papel", "Feuille", "Papel", "Carta", "Бумага", "布", "パー", "보", "ورقة"],
    "games.paylines": ["líneas de pago", "lignes de paiement", "linhas de pagamento", "linee di pagamento", "линий выплат", "赔付线", "ペイライン", "페이라인", "خطوط الدفع"],
    "games.payout": ["Pago", "Gain", "Pagamento", "Vincita", "Выплата", "派彩", "配当", "지급액", "الدفع"],
    "games.question": ["Pregunta", "Question", "Pergunta", "Domanda", "Вопрос", "题目", "問題", "문제", "سؤال"],
    "games.quizTitle": ["Quiz de insignias", "Quiz des badges", "Quiz de emblemas", "Quiz dei badge", "Викторина значков", "徽章问答", "バッジクイズ", "배지 퀴즈", "اختبار الشارات"],
    "games.red": ["Rojo", "Rouge", "Vermelho", "Rosso", "Красное", "红", "赤", "빨강", "أحمر"],
    "games.rock": ["Piedra", "Pierre", "Pedra", "Sasso", "Камень", "石头", "グー", "바위", "حجر"],
    "games.rouletteTitle": ["Ruleta de insignias", "Roulette des badges", "Roleta de emblemas", "Roulette dei badge", "Рулетка значков", "徽章轮盘", "バッジルーレット", "배지 룰렛", "روليت الشارات"],
    "games.scissors": ["Tijera", "Ciseaux", "Tesoura", "Forbice", "Ножницы", "剪刀", "チョキ", "가위", "مقص"],
    "games.skill": ["Habilidad", "Adresse", "Habilidade", "Abilità", "Навык", "技巧", "スキル", "실력", "مهارة"],
    "games.spin": ["GIRAR", "TOURNER", "GIRAR", "GIRA", "КРУТИТЬ", "旋转", "回せ", "회전", "أدر"],
    "games.spinning": ["Girando…", "Rotation…", "Girando…", "Rotazione…", "Вращение…", "旋转中…", "回転中…", "회전 중…", "جارٍ الدوران…"],
    "games.stopAt": ["Repartir hasta", "Tirer jusqu'à", "Distribuir até", "Distribuisci fino a", "Набирать до", "抽到", "引く上限", "받을 때까지", "اسحب حتى"],
    "games.streak": ["Racha", "Série", "Sequência", "Serie", "Серия", "连击", "連続", "연속", "تتابع"],
    "games.tails": ["Cruz", "Face", "Coroa", "Croce", "Решка", "反面", "裏", "뒷면", "كتابة"],
    "games.tie": ["Empate", "Égalité", "Empate", "Pareggio", "Ничья", "平局", "引き分け", "무승부", "تعادل"],
    "games.you": ["Tú", "Toi", "Você", "Tu", "Вы", "你", "あなた", "나", "أنت"],
    "games.youLose": ["Pierdes", "Perdu", "Você perdeu", "Hai perso", "Вы проиграли", "你输了", "負け", "패배", "خسرت"],
    "games.youWin": ["¡Ganas!", "Gagné !", "Você ganhou!", "Hai vinto!", "Вы выиграли!", "你赢了！", "勝利！", "승리!", "فزت!"],
    "nav.achievementsNav": ["Logros", "Succès", "Conquistas", "Obiettivi", "Достижения", "成就", "実績", "업적", "الإنجازات"],
    "nav.feedNav": ["Feed en vivo", "Fil en direct", "Feed ao vivo", "Feed in diretta", "Живая лента", "实时动态", "ライブフィード", "실시간 피드", "الخلاصة المباشرة"],
    "nav.games": ["Juegos", "Jeux", "Jogos", "Giochi", "Игры", "游戏", "ゲーム", "게임", "الألعاب"],
    "nav.menu": ["Menú", "Menu", "Menu", "Menu", "Меню", "菜单", "メニュー", "메뉴", "القائمة"],
    "nav.notifications": ["Notificaciones", "Notifications", "Notificações", "Notifiche", "Уведомления", "通知", "通知", "알림", "الإشعارات"],
    "notifications.title": ["Notificaciones", "Notifications", "Notificações", "Notifiche", "Уведомления", "通知", "通知", "알림", "الإشعارات"],
    "profile.achievementPoints": ["pts", "pts", "pts", "pti", "очк.", "分", "pt", "pt", "نقطة"],
    "profile.achievements": ["Logros", "Succès", "Conquistas", "Obiettivi", "Достижения", "成就", "実績", "업적", "الإنجازات"],
    "profile.views": ["visitas", "vues", "visitas", "visite", "просм.", "浏览", "閲覧", "조회", "مشاهدة"],
    "rarity.rare": ["Rara", "Rare", "Rara", "Raro", "Редкое", "稀有", "レア", "희귀", "نادرة"],
    "stats.badges": ["insignias", "badges", "emblemas", "badge", "значков", "徽章", "バッジ", "배지", "شارات"],
    "stats.hallOfFame": ["Salón de la fama", "Panthéon", "Hall da fama", "Hall of fame", "Зал славы", "名人堂", "殿堂", "명예의 전당", "قاعة المشاهير"],
    "stats.liveDatabase": ["Base de datos", "Base de données", "Banco de dados", "Database", "База данных", "数据库", "データベース", "데이터베이스", "قاعدة البيانات"],
    "stats.source": ["Fuente", "Source", "Fonte", "Sorgente", "Источник", "来源", "ソース", "소스", "المصدر"],
    "stats.total": ["Total", "Total", "Total", "Totale", "Всего", "总计", "合計", "합계", "الإجمالي"],
    "steal.attempt": ["Intentar un golpe", "Tenter un braquage", "Tentar um assalto", "Tenta un colpo", "Попробовать ограбление", "尝试偷取", "強奪を試す", "강탈 시도", "حاول السرقة"],
    "wheel.spin": ["Girar ahora", "Tourner maintenant", "Girar agora", "Gira ora", "Крутить сейчас", "立即旋转", "今すぐ回す", "지금 회전", "أدر الآن"],
    "wheel.spinning": ["Girando…", "Rotation…", "Girando…", "Rotazione…", "Вращение…", "旋转中…", "回転中…", "회전 중…", "جارٍ الدوران…"],
}

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def put(tree, path, value):
    parts = path.split(".")
    node = tree
    for part in parts[:-1]:
        node = node[part]
    node[parts[-1]] = value


bad = [k for k, v in TR.items() if len(v) != len(LOCALES)]
if bad:
    raise SystemExit(f"length mismatch: {bad}")

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
    print(f"{locale}: {len(TR)} labels")

print(f"OK — {written} labels written")