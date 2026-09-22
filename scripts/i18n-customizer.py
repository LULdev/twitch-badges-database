"""Final missing translations (bug B1, part 3): the profile customizer (27 keys)."""
import json
import io
import os

LOCALES = ["es", "fr", "pt", "it", "ru", "zh", "ja", "ko", "ar"]

TR = {
    "customizer.commonSection": [
        "Perfil — ajustes comunes", "Profil — réglages communs", "Perfil — ajustes comuns",
        "Profilo — impostazioni comuni", "Профиль — обычные настройки", "主页 — 常规设置",
        "プロフィール — 一般設定", "프로필 — 일반 설정", "الملف — الإعدادات العادية",
    ],
    "customizer.creativeSection": [
        "Perfil — extras creativos", "Profil — extras créatifs", "Perfil — extras criativos",
        "Profilo — extra creativi", "Профиль — творческие дополнения", "主页 — 创意扩展",
        "プロフィール — クリエイティブ", "프로필 — 창의 요소", "الملف — إضافات إبداعية",
    ],
    "customizer.title": [
        "Título junto al nombre", "Titre à côté du nom", "Título ao lado do nome",
        "Titolo accanto al nome", "Титул рядом с именем", "名字旁的称号",
        "名前の横のタイトル", "이름 옆 칭호", "لقب بجانب الاسم",
    ],
    "customizer.banner": [
        "URL de la imagen de banner", "URL de l'image de bannière", "URL da imagem de banner",
        "URL immagine del banner", "URL изображения баннера", "横幅图片 URL",
        "バナー画像のURL", "배너 이미지 URL", "رابط صورة اللافتة",
    ],
    "customizer.nameGradient": [
        "Degradado del nombre (colores separados por comas)",
        "Dégradé du nom (couleurs séparées par des virgules)",
        "Gradiente do nome (cores separadas por vírgulas)",
        "Sfumatura del nome (colori separati da virgole)",
        "Градиент имени (цвета через запятую)",
        "名字渐变（颜色以逗号分隔）",
        "名前のグラデーション（色をカンマ区切り）",
        "이름 그라디언트(색상을 쉼표로 구분)",
        "تدرّج الاسم (ألوان مفصولة بفواصل)",
    ],
    "customizer.showcaseLayout": [
        "Diseño de la vitrina", "Disposition de la vitrine", "Layout da vitrine",
        "Layout della vetrina", "Раскладка витрины", "展柜布局", "ショーケースの配置",
        "쇼케이스 레이아웃", "تخطيط الواجهة",
    ],
    "customizer.showCoins": [
        "Mostrar saldo de monedas", "Afficher le solde de pièces", "Mostrar saldo de moedas",
        "Mostra il saldo monete", "Показывать баланс монет", "显示硬币余额",
        "コイン残高を表示", "코인 잔액 표시", "إظهار رصيد العملات",
    ],
    "customizer.socialTwitter": [
        "Usuario de Twitter/X", "Nom d'utilisateur Twitter/X", "Usuário do Twitter/X",
        "Nome utente Twitter/X", "Имя пользователя Twitter/X", "Twitter/X 用户名",
        "Twitter/Xのユーザー名", "Twitter/X 사용자 이름", "اسم مستخدم Twitter/X",
    ],
    "customizer.socialDiscord": [
        "Usuario de Discord", "Nom d'utilisateur Discord", "Usuário do Discord",
        "Nome utente Discord", "Имя пользователя Discord", "Discord 用户名",
        "Discordのユーザー名", "Discord 사용자 이름", "اسم مستخدم Discord",
    ],
    "customizer.auraHint": [
        "Brillo suave de color alrededor de la cabecera de tu perfil",
        "Halo coloré doux autour de l'en-tête de ton profil",
        "Brilho suave colorido ao redor do cabeçalho do perfil",
        "Bagliore colorato morbido attorno all'intestazione del profilo",
        "Мягкое цветное свечение вокруг шапки профиля",
        "主页头部周围的柔和彩色光晕",
        "プロフィールヘッダー周りの柔らかな光",
        "프로필 헤더 주변의 부드러운 색 광채",
        "توهّج لوني ناعم حول رأس ملفك",
    ],
    "customizer.particles": [
        "Partículas de insignias cayendo", "Particules de badges tombantes",
        "Partículas de emblemas caindo", "Particelle di badge che cadono",
        "Падающие частицы значков", "飘落的徽章粒子", "舞い落ちるバッジの粒子",
        "떨어지는 배지 입자", "جزيئات شارات متساقطة",
    ],
    "customizer.particlesHint": [
        "Las insignias caen suavemente por tu perfil",
        "Les badges descendent doucement sur ton profil",
        "Os emblemas descem suavemente pelo seu perfil",
        "I badge scendono dolcemente sul tuo profilo",
        "Значки мягко опускаются по вашему профилю",
        "徽章缓缓飘落你的主页",
        "バッジがプロフィールをゆっくり舞い降ります",
        "배지가 프로필 위로 천천히 내려옵니다",
        "تتساقط الشارات بهدوء على ملفك",
    ],
    "customizer.nameRainbow": [
        "Animación de nombre arcoíris", "Animation de nom arc-en-ciel",
        "Animação de nome arco-íris", "Animazione nome arcobaleno",
        "Радужная анимация имени", "彩虹名字动画", "レインボーネームのアニメーション",
        "무지개 이름 애니메이션", "تحريك الاسم بألوان قوس قزح",
    ],
    "customizer.bannerShine": [
        "Brillo deslizante en el banner", "Reflet glissant sur la bannière",
        "Brilho deslizante no banner", "Riflesso scorrevole sul banner",
        "Скользящий блик по баннеру", "横幅上的流光扫过", "バナーを流れる光沢",
        "배너에 흐르는 광택", "لمعان يمر على اللافتة",
    ],
    "customizer.tilt3d": [
        "Inclinación 3D en las insignias de la vitrina",
        "Inclinaison 3D sur les badges de la vitrine",
        "Inclinação 3D nos emblemas da vitrine",
        "Inclinazione 3D sui badge della vetrina",
        "3D-наклон значков витрины", "展柜徽章的 3D 倾斜",
        "ショーケースバッジの3Dチルト", "쇼케이스 배지의 3D 기울기",
        "إمالة ثلاثية الأبعاد لشارات الواجهة",
    ],
    "customizer.pixelAvatar": [
        "Avatar pixelado", "Avatar pixelisé", "Avatar pixelado",
        "Avatar pixelato", "Пиксельный аватар", "像素化头像",
        "ピクセルアバター", "픽셀 아바타", "صورة رمزية بنمط البكسل",
    ],
    "customizer.achievementTicker": [
        "Ticker de logros en movimiento", "Bandeau défilant des succès",
        "Ticker de conquistas em movimento", "Ticker obiettivi scorrevole",
        "Бегущая строка достижений", "滚动成就跑马灯", "実績のスクロールティッカー",
        "업적 스크롤 티커", "شريط إنجازات متحرك",
    ],
    "customizer.greetingBanner": [
        "Saludo según la hora del día", "Salutation selon l'heure",
        "Saudação conforme a hora do dia", "Saluto in base all'ora del giorno",
        "Приветствие по времени суток", "按时段问候", "時間帯に応じた挨拶",
        "시간대별 인사말", "تحية حسب وقت اليوم",
    ],
    "customizer.levelHalo": [
        "Color del halo de la insignia de nivel", "Couleur du halo du badge de niveau",
        "Cor do halo do emblema de nível", "Colore dell'alone del badge livello",
        "Цвет ореола значка уровня", "等级徽章光环颜色", "レベルバッジのハロー色",
        "레벨 배지 후광 색상", "لون هالة شارة المستوى",
    ],
    "customizer.statusBubble": [
        "Texto de la burbuja de estado", "Texte de la bulle de statut",
        "Texto do balão de status", "Testo della bolla di stato",
        "Текст пузыря статуса", "状态气泡文本", "ステータスバブルのテキスト",
        "상태 말풍선 텍스트", "نص فقاعة الحالة",
    ],
    "customizer.effectsIntensity": [
        "Intensidad de los efectos", "Intensité des effets", "Intensidade dos efeitos",
        "Intensità degli effetti", "Интенсивность эффектов", "特效强度",
        "エフェクトの強さ", "효과 강도", "شدة التأثيرات",
    ],
    "customizer.coinRainAuto": [
        "Pulso automático del botón de lluvia de monedas",
        "Pulsation automatique du bouton de pluie de pièces",
        "Pulso automático do botão de chuva de moedas",
        "Pulsazione automatica del pulsante pioggia di monete",
        "Автопульсация кнопки дождя монет",
        "硬币雨按钮自动脉动",
        "コインの雨ボタンの自動パルス",
        "코인 비 버튼 자동 펄스",
        "نبض تلقائي لزر مطر العملات",
    ],
    "customizer.visitorMarquee": [
        "Visitantes como marquesina de avatares",
        "Visiteurs en bandeau d'avatars",
        "Visitantes como marquee de avatares",
        "Visitatori come marquee di avatar",
        "Посетители в виде бегущей строки аватаров",
        "以头像跑马灯展示访客",
        "訪問者をアバターのマーキーで表示",
        "방문자를 아바타 마퀴로 표시",
        "الزوار كشريط صور رمزية متحرك",
    ],
    "customizer.stealEnabled": [
        "Permitir robar monedas en mi perfil",
        "Autoriser le vol de pièces sur mon profil",
        "Permitir roubo de moedas no meu perfil",
        "Consenti il furto di monete sul mio profilo",
        "Разрешить кражу монет в моём профиле",
        "允许在我的主页偷取硬币",
        "プロフィールでのコイン強奪を許可",
        "내 프로필에서 코인 훔치기 허용",
        "السماح بسرقة العملات في ملفي",
    ],
    "customizer.stealPrice": [
        "Precio del intento (BadgesCoins)", "Prix de la tentative (BadgesCoins)",
        "Preço da tentativa (BadgesCoins)", "Prezzo del tentativo (BadgesCoins)",
        "Цена попытки (BadgesCoins)", "尝试价格（BadgesCoins）",
        "試行価格（BadgesCoins）", "시도 비용 (BadgesCoins)",
        "تكلفة المحاولة (BadgesCoins)",
    ],
    "customizer.stealMax": [
        "Botín máximo por golpe", "Butin maximal par braquage",
        "Saque máximo por assalto", "Bottino massimo per colpo",
        "Максимум добычи за ограбление", "单次偷取最大收获",
        "1回の強奪での最大獲得", "강탈 1회 최대 습득", "أقصى غنيمة لكل سرقة",
    ],
    "customizer.stealHint": [
        "Los precios altos ahuyentan a los ladrones casuales; los intentos fallidos te pagan el precio.",
        "Des prix élevés découragent les voleurs occasionnels ; les tentatives échouées te versent le prix.",
        "Preços altos afastam ladrões casuais; tentativas falhas pagam o preço a você.",
        "Prezzi alti scoraggiano i ladri occasionali; i tentativi falliti ti pagano il prezzo.",
        "Высокая цена отпугивает случайных воров; неудачные попытки приносят цену вам.",
        "价格越高越能吓退顺手牵羊者；失败时价格归你所有。",
        "価格が高いほど気軽な泥棒を抑えられます。失敗時は価格があなたに支払われます。",
        "비용이 높을수록 가벼운 도둑을 막습니다. 실패 시 비용은 당신에게 지급됩니다.",
        "التكلفة الأعلى تُبعد السارقين العابرين؛ والمحاولات الفاشلة تدفع لك التكلفة.",
    ],
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
    print(f"{locale}: {len(TR)} customizer keys")

print(f"OK — {written} strings written")