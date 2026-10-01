// One-shot: insert notifications.recapToggle/recapHint (after recapToggle anchor
// "pushFailed") and games.recapNext/recapLatest (after games.hubSubtitle) in all
// 11 locale files. Delete after use.
const fs = require("node:fs");

const NOTIF = {
  en: ["Arcade recaps", "Daily and weekly arcade recap notifications. You can switch them off here without losing other alerts; recaps still appear in the feed below."],
  de: ["Arcade-Rückblicke", "Tägliche und wöchentliche Arcade-Rückblick-Benachrichtigungen. Lassen sie sich hier abschalten, ohne andere Hinweise zu verlieren; die Rückblicke erscheinen weiter im Feed unten."],
  es: ["Resúmenes arcade", "Notificaciones diarias y semanales de resúmenes arcade. Puedes desactivarlas aquí sin perder otras alertas; los resúmenes siguen apareciendo en el feed de abajo."],
  fr: ["Récaps arcade", "Notifications quotidiennes et hebdomadaires des récaps arcade. Vous pouvez les désactiver ici sans perdre les autres alertes ; les récaps restent visibles dans le fil ci-dessous."],
  pt: ["Resumos arcade", "Notificações diárias e semanais dos resumos arcade. Pode desligá-las aqui sem perder outros alertas; os resumos continuam a aparecer no feed abaixo."],
  ru: ["Аркадные обзоры", "Ежедневные и еженедельные уведомления аркадных обзоров. Их можно отключить здесь, не теряя других оповещений; обзоры по-прежнему появляются в ленте ниже."],
  zh: ["街机回顾", "每日和每周街机回顾通知。可在此关闭而不影响其他提醒；回顾仍会显示在下方的动态中。"],
  ar: ["ملخصات الألعاب", "إشعار ملخصات الألعاب اليومية والأسبوعية. يمكنك إيقافها هنا دون فقدان التنبيهات الأخرى؛ وتظل الملخصات تظهر في التدفق أدناه."],
  ja: ["アーケードまとめ", "毎日・毎週のアーケードまとめ通知。ほかの通知を保ったままここでオフにできます。まとめ自体は下のフィードに表示されます。"],
  it: ["Recap arcade", "Notifiche giornaliere e settimanali dei recap arcade. Puoi disattivarle qui senza perdere gli altri avvisi; i recap restano visibili nel feed qui sotto."],
  ko: ["아케이드 요약", "매일·매주 아케이드 요약 알림입니다. 다른 알림은 그대로 둔 채 여기서 끌 수 있고, 요약은 아래 피드에 계속 표시됩니다."],
};

const GAMES = {
  en: ["The next arcade recap publishes at {time} UTC.", "Latest arcade recap"],
  de: ["Der nächste Arcade-Rückblick erscheint um {time} UTC.", "Neuester Arcade-Rückblick"],
  es: ["El próximo resumen arcade se publica a las {time} UTC.", "Último resumen arcade"],
  fr: ["Le prochain récap arcade paraît à {time} UTC.", "Dernier récap arcade"],
  it: ["Il prossimo recap arcade viene pubblicato alle {time} UTC.", "Ultimo recap arcade"],
  pt: ["O próximo resumo arcade é publicado às {time} UTC.", "Último resumo arcade"],
  ru: ["Следующий аркадный обзор выходит в {time} UTC.", "Последний аркадный обзор"],
  zh: ["下一份街机回顾将于 {time}（UTC）发布。", "最新街机回顾"],
  ar: ["يُنشر ملخص الألعاب التالي في الساعة {time} بتوقيت UTC.", "أحدث ملخص ألعاب"],
  ja: ["次のアーケードまとめは{time}（UTC）に公開されます。", "最新のアーケードまとめ"],
  ko: ["다음 아케이드 요약은 {time}(UTC)에 게시됩니다.", "최신 아케이드 요약"],
};

function insertAfter(lines, test, newLines) {
  const idx = lines.findIndex(test);
  if (idx === -1) throw new Error("anchor not found");
  if (newLines.every((n) => lines.includes(n))) return "skip";
  lines.splice(idx + 1, 0, ...newLines);
  return idx + 2;
}

for (const locale of Object.keys(NOTIF)) {
  const path = `messages/${locale}.json`;
  const lines = fs.readFileSync(path, "utf8").split("\n");
  const indent4 = "    ";

  // notifications.recapToggle + recapHint after notifications.pushFailed
  const notif = NOTIF[locale];
  const at1 = insertAfter(
    lines,
    (l) => /^\s*"pushFailed": /.test(l),
    [
      `${indent4}"recapToggle": ${JSON.stringify(notif[0])},`,
      `${indent4}"recapHint": ${JSON.stringify(notif[1])},`,
    ],
  );

  // games.recapNext + recapLatest after games.hubSubtitle
  const games = GAMES[locale];
  const at2 = insertAfter(
    lines,
    (l) => /^\s*"hubSubtitle": /.test(l),
    [
      `${indent4}"recapNext": ${JSON.stringify(games[0])},`,
      `${indent4}"recapLatest": ${JSON.stringify(games[1])},`,
    ],
  );

  fs.writeFileSync(path, lines.join("\n"));
  JSON.parse(fs.readFileSync(path, "utf8")); // throws on breakage
  console.log(`${locale}: notif@${at1} games@${at2}`);
}
