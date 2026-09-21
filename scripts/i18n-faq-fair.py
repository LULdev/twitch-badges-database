"""Adds the missing faq.fairQ / faq.fairA pair to all 11 locale files."""
import json
import io
import os

LOCALES = ["en", "de", "es", "fr", "pt", "it", "ru", "zh", "ja", "ko", "ar"]

QUESTION = [
    "Is the XP and BadgesCoin system fair?",
    "Ist das XP- und BadgesCoins-System fair?",
    "¿Es justo el sistema de XP y BadgesCoins?",
    "Le système d'XP et de BadgesCoins est-il équitable ?",
    "O sistema de XP e BadgesCoins é justo?",
    "Il sistema di XP e BadgesCoins è equo?",
    "Честна ли система XP и BadgesCoins?",
    "XP 与 BadgesCoins 系统公平吗？",
    "XPとBadgesCoinsの仕組みは公平ですか？",
    "XP와 BadgesCoins 시스템은 공정한가요?",
    "هل نظام XP وBadgesCoins عادل؟",
]

ANSWER = [
    "Yes, and it is built to stay that way. Every game outcome is decided on the "
    "server, never in your browser. Games are capped at 100 XP per day so nobody "
    "can farm XP in a loop, view counters ignore repeat reloads from the same IP "
    "for five minutes, and stealing has both a per-victim cooldown and an hourly "
    "limit. The whole economy is public on the statistics page, so you can always "
    "check the numbers yourself.",
    "Ja, und das System ist darauf ausgelegt, es zu bleiben. Jedes Spielergebnis "
    "wird auf dem Server entschieden, nie in deinem Browser. Spiele sind auf 100 XP "
    "pro Tag begrenzt, damit niemand XP in einer Schleife farmt, View-Zähler "
    "ignorieren wiederholte Aufrufe derselben IP für fünf Minuten, und beim Stehlen "
    "gibt es sowohl eine Sperre pro Opfer als auch ein Stundenlimit. Die gesamte "
    "Wirtschaft ist auf der Statistikseite öffentlich, du kannst die Zahlen also "
    "jederzeit selbst prüfen.",
    "Sí, y está diseñado para seguir siéndolo. Cada resultado de juego se decide en "
    "el servidor, nunca en tu navegador. Los juegos tienen un límite de 100 XP al "
    "día para que nadie farmee XP en bucle, los contadores de visitas ignoran las "
    "recargas repetidas de la misma IP durante cinco minutos, y el robo tiene tanto "
    "un enfriamiento por víctima como un límite por hora. Toda la economía es "
    "pública en la página de estadísticas, así que puedes comprobar los números tú "
    "mismo.",
    "Oui, et le système est conçu pour le rester. Chaque résultat de jeu est décidé "
    "sur le serveur, jamais dans ton navigateur. Les jeux sont plafonnés à 100 XP "
    "par jour pour que personne ne farme l'XP en boucle, les compteurs de vues "
    "ignorent les rechargements répétés depuis la même IP pendant cinq minutes, et "
    "le vol a à la fois un délai par victime et une limite horaire. Toute l'économie "
    "est publique sur la page de statistiques : tu peux vérifier les chiffres "
    "toi-même.",
    "Sim, e foi construído para continuar assim. Cada resultado de jogo é decidido no "
    "servidor, nunca no seu navegador. Os jogos têm limite de 100 XP por dia para "
    "que ninguém farme XP em loop, os contadores de visualização ignoram recargas "
    "repetidas do mesmo IP por cinco minutos, e o roubo tem tanto um tempo de espera "
    "por vítima quanto um limite por hora. Toda a economia é pública na página de "
    "estatísticas, então você pode conferir os números por conta própria.",
    "Sì, ed è progettato per restarlo. Ogni esito di gioco viene deciso sul server, "
    "mai nel tuo browser. I giochi hanno un tetto di 100 XP al giorno così nessuno "
    "può farmare XP in loop, i contatori di visualizzazione ignorano le ricariche "
    "ripetute dallo stesso IP per cinque minuti, e il furto ha sia un'attesa per "
    "vittima sia un limite orario. L'intera economia è pubblica nella pagina delle "
    "statistiche, quindi puoi sempre verificare i numeri da solo.",
    "Да, и система построена так, чтобы такой и оставаться. Исход каждой игры "
    "определяется на сервере, а не в вашем браузере. Игры ограничены 100 XP в день, "
    "чтобы никто не фармил XP в цикле, счётчики просмотров игнорируют повторные "
    "загрузки с одного IP в течение пяти минут, а у кражи есть и задержка на каждую "
    "жертву, и почасовой лимит. Вся экономика открыта на странице статистики, так "
    "что вы всегда можете проверить цифры сами.",
    "公平，而且系统就是这样设计的。每个游戏结果都在服务器端决定，绝不在你的浏览器里。"
    "游戏每天上限 100 XP，没人能循环刷分；浏览计数在五分钟内忽略同一 IP 的重复刷新；"
    "偷取既有对单个目标的冷却，也有每小时的次数上限。整个经济体系都在统计页面公开，"
    "你可以随时自己核对数字。",
    "はい、そして公平であり続けるように作られています。ゲームの結果はすべてサーバー側で"
    "決定され、ブラウザでは決まりません。ゲームは1日100 XPが上限なのでループで稼ぐことは"
    "できず、閲覧カウンターは同じIPからの再読み込みを5分間無視し、盗みには相手ごとの"
    "クールダウンと1時間あたりの上限があります。経済の全体は統計ページで公開されているので、"
    "数字はいつでも自分で確認できます。",
    "네, 그리고 공정함을 유지하도록 설계되었습니다. 모든 게임 결과는 서버에서 결정되며 "
    "브라우저에서는 결정되지 않습니다. 게임은 하루 100 XP로 제한되어 반복 파밍이 불가능하고, "
    "조회수 카운터는 같은 IP의 새로고침을 5분간 무시하며, 훔치기에는 대상별 대기 시간과 "
    "시간당 제한이 있습니다. 경제 전체가 통계 페이지에 공개되어 있으니 언제든 직접 "
    "확인할 수 있습니다.",
    "نعم، والنظام مبني ليبقى عادلًا. نتيجة كل لعبة تُحدَّد على الخادم، لا في متصفحك. "
    "الألعاب محدودة بـ 100 XP يوميًا حتى لا يستطيع أحد جمع النقاط في حلقة، وعدّادات "
    "المشاهدات تتجاهل إعادة التحميل من نفس عنوان IP لمدة خمس دقائق، وللسرقة مهلة لكل "
    "ضحية وحدّ أقصى كل ساعة. الاقتصاد بالكامل منشور على صفحة الإحصائيات، لذا يمكنك "
    "دائمًا التحقق من الأرقام بنفسك.",
]

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for index, locale in enumerate(LOCALES):
    path = os.path.join(root, "messages", f"{locale}.json")
    with io.open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    faq = data.setdefault("faq", {})
    faq["fairQ"] = QUESTION[index]
    faq["fairA"] = ANSWER[index]
    data["faq"] = dict(sorted(faq.items()))
    with io.open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"{locale}: faq keys = {len(data['faq'])}")

print(f"OK — fairQ/fairA added to {len(LOCALES)} locales")
