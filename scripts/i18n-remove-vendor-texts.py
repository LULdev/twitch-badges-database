"""Phase 4: remove public texts that name badges.blog, badgebase.de or potat.app.

Only user-visible strings in messages/*.json are touched — no function, API,
fetch target, database column or sync source changes. Keys whose whole value
described the vendor are rewritten; `badges.rarityFormula` keeps its wording and
only loses the source reference. Two stray ". " artifacts in the zh/ja rarity
formula are cleaned up in the same pass.
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

LOCALES = ["en", "de", "es", "fr", "pt", "it", "ru", "zh", "ja", "ko", "ar"]

WHOLE = {
    "badges.ownerTrendSubtitle": {
        "en": "Live owner counts, refreshed every 15 minutes",
        "de": "Live-Besitzerzahlen, alle 15 Minuten aktualisiert",
        "es": "Recuentos de propietarios en vivo, actualizados cada 15 minutos",
        "fr": "Nombre de propriétaires en direct, actualisé toutes les 15 minutes",
        "pt": "Contagem de proprietários ao vivo, atualizada a cada 15 minutos",
        "it": "Conteggi dei possessori in tempo reale, aggiornati ogni 15 minuti",
        "ru": "Живые данные о владельцах, обновление каждые 15 минут",
        "zh": "实时持有者数量，每 15 分钟刷新",
        "ja": "所有者数のライブ値、15分ごとに更新",
        "ko": "실시간 소유자 수, 15분마다 갱신",
        "ar": "أعداد المالكين الحية، تُحدَّث كل 15 دقيقة",
    },
    "leaderboards.topCollectorsDesc": {
        "en": "Users with the most owned badges across the community",
        "de": "Nutzer mit den meisten besessenen Badges in der Community",
        "es": "Usuarios con más insignias en la comunidad",
        "fr": "Utilisateurs possédant le plus de badges dans la communauté",
        "pt": "Usuários com mais emblemas na comunidade",
        "it": "Utenti con più badge nella community",
        "ru": "Пользователи с наибольшим числом значков в сообществе",
        "zh": "社区中持有徽章最多的用户",
        "ja": "コミュニティで最も多くバッジを持つユーザー",
        "ko": "커뮤니티에서 배지를 가장 많이 보유한 사용자",
        "ar": "المستخدمون الأكثر امتلاكًا للشارات في المجتمع",
    },
    "leaderboards.badgesblogRankingDesc": {
        "en": "Badge counts across the community",
        "de": "Badge-Zahlen aus der Community",
        "es": "Recuento de insignias de la comunidad",
        "fr": "Nombre de badges dans la communauté",
        "pt": "Contagem de emblemas da comunidade",
        "it": "Conteggio badge della community",
        "ru": "Количество значков в сообществе",
        "zh": "社区徽章数量",
        "ja": "コミュニティのバッジ数",
        "ko": "커뮤니티 배지 수",
        "ar": "أعداد الشارات في المجتمع",
    },
    "profile.potatLevel": {
        "en": "Community level",
        "de": "Community-Level",
        "es": "Nivel de comunidad",
        "fr": "Niveau communautaire",
        "pt": "Nível de comunidade",
        "it": "Livello community",
        "ru": "Уровень сообщества",
        "zh": "社区等级",
        "ja": "コミュニティレベル",
        "ko": "커뮤니티 레벨",
        "ar": "مستوى المجتمع",
    },
    "profile.potatoes": {
        "en": "Community points",
        "de": "Community-Punkte",
        "es": "Puntos de comunidad",
        "fr": "Points communautaires",
        "pt": "Pontos de comunidade",
        "it": "Punti community",
        "ru": "Очки сообщества",
        "zh": "社区积分",
        "ja": "コミュニティポイント",
        "ko": "커뮤니티 포인트",
        "ar": "نقاط المجتمع",
    },
    "profile.potatSince": {
        "en": "In the community since",
        "de": "In der Community seit",
        "es": "En la comunidad desde",
        "fr": "Dans la communauté depuis",
        "pt": "Na comunidade desde",
        "it": "Nella community dal",
        "ru": "В сообществе с",
        "zh": "加入社区时间",
        "ja": "コミュニティ参加",
        "ko": "커뮤니티 참여 시점",
        "ar": "في المجتمع منذ",
    },
    "inventory.subtitle": {
        "en": "Synced live from your Twitch account",
        "de": "Live aus deinem Twitch-Konto synchronisiert",
        "es": "Sincronizado en vivo desde tu cuenta de Twitch",
        "fr": "Synchronisé en direct depuis ton compte Twitch",
        "pt": "Sincronizado ao vivo da sua conta da Twitch",
        "it": "Sincronizzato in tempo reale dal tuo account Twitch",
        "ru": "Синхронизируется в реальном времени из вашего аккаунта Twitch",
        "zh": "从你的 Twitch 账户实时同步",
        "ja": "Twitchアカウントからライブ同期",
        "ko": "Twitch 계정에서 실시간 동기화",
        "ar": "تتم المزامنة مباشرة من حسابك على Twitch",
    },
    "footer.sourcesDesc": {
        "en": "Badge catalog from the official Twitch API. Drop windows, owner statistics and collector leaderboards are aggregated from public community sources, and the badges you own are resolved live from your Twitch account.",
        "de": "Badge-Katalog aus der offiziellen Twitch-API. Drop-Fenster, Besitzer-Statistiken und Sammler-Bestenlisten werden aus öffentlichen Community-Quellen zusammengeführt, und deine eigenen Badges werden live aus deinem Twitch-Konto ermittelt.",
        "es": "Catálogo de insignias de la API oficial de Twitch. Las ventanas de drop, las estadísticas de propietarios y las clasificaciones se agregan a partir de fuentes comunitarias públicas, y tus insignias se resuelven en vivo desde tu cuenta de Twitch.",
        "fr": "Catalogue de badges depuis l'API officielle Twitch. Les fenêtres de drop, les statistiques de détenteurs et les classements sont agrégés à partir de sources communautaires publiques, et tes badges sont résolus en direct depuis ton compte Twitch.",
        "pt": "Catálogo de emblemas da API oficial da Twitch. Janelas de drop, estatísticas de proprietários e rankings são agregados de fontes comunitárias públicas, e os seus emblemas são resolvidos ao vivo a partir da sua conta da Twitch.",
        "it": "Catalogo dei badge dall'API ufficiale di Twitch. Finestre di drop, statistiche sui possessori e classifiche sono aggregate da fonti comunitarie pubbliche, e i tuoi badge vengono risolti live dal tuo account Twitch.",
        "ru": "Каталог значков из официального API Twitch. Окна дропов, статистика владельцев и таблицы лидеров собираются из открытых источников сообщества, а ваши значки определяются в реальном времени из вашего аккаунта Twitch.",
        "zh": "徽章目录来自 Twitch 官方 API。掉落时间窗口、持有者统计与排行榜汇总自公开的社区来源，你拥有的徽章则从你的 Twitch 账户实时解析。",
        "ja": "バッジカタログはTwitch公式APIから取得。ドロップ期間・所有者統計・ランキングは公開コミュニティ情報を集約し、所有バッジはTwitchアカウントからライブで判定します。",
        "ko": "배지 카탈로그는 Twitch 공식 API에서 가져옵니다. 드롭 기간, 소유자 통계, 랭킹은 공개 커뮤니티 출처에서 집계하며, 보유 배지는 Twitch 계정에서 실시간으로 확인합니다.",
        "ar": "كتالوج الشارات من واجهة Twitch الرسمية. تُجمَّع نوافذ الإصدار وإحصاءات المالكين والتصنيفات من مصادر مجتمعية عامة، أما شاراتك فتُحدَّد مباشرة من حسابك على Twitch.",
    },
}

# (old fragment, new fragment) for the rarity formula: keep the sentence, drop
# the source reference. The zh/ja entries also clean a stray ". " artifact.
FRAGMENT = {
    "en": [("24h momentum from potat.app (10%)", "24h momentum (10%)")],
    "de": [("24h-Momentum von potat.app (10 %)", "24h-Momentum (10 %)")],
    "es": [("impulso de 24h de potat.app (10%)", "impulso de 24h (10%)")],
    "fr": [("momentum 24h de potat.app (10%)", "momentum 24h (10%)")],
    "pt": [("momentum de 24h do potat.app (10%)", "momentum de 24h (10%)")],
    "it": [("slancio 24h da potat.app (10%)", "slancio 24h (10%)")],
    "ru": [("24-часовой импульс с potat.app (10%)", "24-часовой импульс (10%)")],
    "zh": [
        ("来自 potat.app 的 24 小时增长势头（10%）", "24 小时增长势头（10%）"),
        ("六个等级。. ", "六个等级。"),
    ],
    "ja": [
        ("potat.appの24時間の勢い（10%）", "24時間の勢い（10%）"),
        ("6段階に判定します。. ", "6段階に判定します。"),
    ],
    "ko": [("potat.app의 24시간 모멘텀(10%)", "24시간 모멘텀(10%)")],
    "ar": [("وزخم 24 ساعة من potat.app (10%)", "وزخم 24 ساعة (10%)")],
}

VENDORS = ["badges.blog", "badgebase.de", "potat.app", "Potat", "potatoes", "potato"]

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def put(tree, path, value):
    parts = path.split(".")
    node = tree
    for part in parts[:-1]:
        node = node[part]
    node[parts[-1]] = value


def get(tree, path):
    node = tree
    for part in path.split("."):
        node = node[part]
    return node


problems = []
for locale in LOCALES:
    path = os.path.join(root, "messages", f"{locale}.json")
    with io.open(path, encoding="utf-8") as handle:
        data = json.load(handle)

    for key, values in WHOLE.items():
        put(data, key, values[locale])

    value = get(data, "badges.rarityFormula")
    for old, new in FRAGMENT[locale]:
        if old not in value:
            problems.append(f"{locale}: fragment not found -> {old!r}")
            continue
        value = value.replace(old, new)
    put(data, "badges.rarityFormula", value)

    with io.open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    # report any remaining vendor mention in this locale
    leftover = []
    stack = [(data, "")]
    while stack:
        node, prefix = stack.pop()
        for k, v in node.items():
            path_k = f"{prefix}{k}"
            if isinstance(v, dict):
                stack.append((v, path_k + "."))
            elif isinstance(v, str):
                for vendor in VENDORS:
                    if vendor in v:
                        leftover.append(f"{path_k} ({vendor})")
    print(f"{locale}: rewritten, leftover vendor mentions: {leftover or 'none'}")

if problems:
    raise SystemExit("FAILED: " + "; ".join(problems))
print("OK — public vendor texts removed")