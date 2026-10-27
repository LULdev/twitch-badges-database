/**
 * One-off #2: the 0081 feature-round i18n keys (12 keys, three namespaces)
 * into all 11 messages files. Same discipline as insert-crash-i18n.mjs:
 * parse + round-trip validate BEFORE any write, anchor by key, assert after.
 *
 * Run: node scripts/insert-crash-i18n-2.mjs
 */
import fs from "node:fs";

const T = {
  en: {
    games: {
      crashLive: "{n} rockets airborne · top {mult}×",
      crashFairTitle: "Provably fair",
      crashFairBody:
        "Every flight's crash point is fixed before launch: HMAC-SHA256(server seed, flight id) yields a uniform number u (the first 13 hex digits over 2^52), and the point is 0.96 / (1 − u), clamped to 1.00×–250.00×. The seed publishes with every settled flight below — hash it yourself and replay the math.",
      crashFairRow: "crash {crash}× · cashed {cashed}×",
      crashFairRowLoss: "crash {crash}×",
      crashFairSeed: "seed",
      crashAutoCustom: "Custom",
    },
    leaderboards: {
      crashTopTitle: "Highest Rocket Cash-Out",
      crashTopDesc: "The best banked multiplier on a single Badge Rocket flight — nerve, not volume.",
      crashTopUnit: "Best cash-out",
    },
    profile: {
      crashBestLine: "Best Badge Rocket cash-out: {mult}× (+{n} coins)",
      crashShareTitle: "{name}'s best Badge Rocket flight",
    },
  },
  de: {
    games: {
      crashLive: "{n} Raketen in der Luft · Top {mult}×",
      crashFairTitle: "Provably Fair",
      crashFairBody:
        "Der Crash-Punkt jedes Fluges steht vor dem Start fest: HMAC-SHA256(server seed, flight id) liefert eine gleichverteilte Zahl u (die ersten 13 Hex-Ziffern über 2^52), und der Punkt ist 0.96 / (1 − u), begrenzt auf 1.00×–250.00×. Der Seed wird zu jedem abgeschlossenen Flug unten veröffentlicht — hash ihn selbst und rechne die Mathematik nach.",
      crashFairRow: "Crash {crash}× · Cashout {cashed}×",
      crashFairRowLoss: "Crash {crash}×",
      crashFairSeed: "Seed",
      crashAutoCustom: "Benutzerdefiniert",
    },
    leaderboards: {
      crashTopTitle: "Höchster Raketen-Cashout",
      crashTopDesc: "Der beste gesicherte Multiplikator in einem einzigen Flug von Badge Rocket — Nerven, nicht Masse.",
      crashTopUnit: "Bester Cashout",
    },
    profile: {
      crashBestLine: "Bester Badge Rocket Cashout: {mult}× (+{n} Coins)",
      crashShareTitle: "Der beste Badge Rocket Flug von {name}",
    },
  },
  es: {
    games: {
      crashLive: "{n} cohetes en vuelo · top {mult}×",
      crashFairTitle: "Demostrablemente justo",
      crashFairBody:
        "El punto de crash de cada vuelo se fija antes del despegue: HMAC-SHA256(server seed, flight id) genera un número uniforme u (los primeros 13 dígitos hex sobre 2^52), y el punto es 0.96 / (1 − u), acotado a 1.00×–250.00×. La semilla se publica con cada vuelo resuelto aquí abajo — calcula el hash tú mismo y repite el cálculo.",
      crashFairRow: "crash {crash}× · cobrado {cashed}×",
      crashFairRowLoss: "crash {crash}×",
      crashFairSeed: "semilla",
      crashAutoCustom: "Personalizado",
    },
    leaderboards: {
      crashTopTitle: "Mayor cobro del cohete",
      crashTopDesc: "El mejor multiplicador asegurado en un solo vuelo de Badge Rocket — nervio, no volumen.",
      crashTopUnit: "Mejor cobro",
    },
    profile: {
      crashBestLine: "Mejor cobro en Badge Rocket: {mult}× (+{n} monedas)",
      crashShareTitle: "El mejor vuelo de {name} en Badge Rocket",
    },
  },
  fr: {
    games: {
      crashLive: "{n} fusées en vol · top {mult}×",
      crashFairTitle: "Équité prouvable",
      crashFairBody:
        "Le point de crash de chaque vol est fixé avant le lancement : HMAC-SHA256(server seed, flight id) donne un nombre uniforme u (les 13 premiers chiffres hex sur 2^52), et le point est 0.96 / (1 − u), borné à 1.00×–250.00×. La seed est publiée avec chaque vol terminé ci-dessous — hashez-la vous-même et refaites le calcul.",
      crashFairRow: "crash {crash}× · encaissé {cashed}×",
      crashFairRowLoss: "crash {crash}×",
      crashFairSeed: "seed",
      crashAutoCustom: "Personnalisé",
    },
    leaderboards: {
      crashTopTitle: "Plus haut cash-out de fusée",
      crashTopDesc: "Le meilleur multiplicateur encaissé sur un seul vol de Badge Rocket — des nerfs, pas du volume.",
      crashTopUnit: "Meilleur cash-out",
    },
    profile: {
      crashBestLine: "Meilleur cash-out sur Badge Rocket : {mult}× (+{n} coins)",
      crashShareTitle: "Le meilleur vol de {name} sur Badge Rocket",
    },
  },
  it: {
    games: {
      crashLive: "{n} razzi in volo · top {mult}×",
      crashFairTitle: "Dimostrabilmente equo",
      crashFairBody:
        "Il punto di crash di ogni volo è fissato prima del lancio: HMAC-SHA256(server seed, flight id) genera un numero uniforme u (le prime 13 cifre hex su 2^52), e il punto è 0.96 / (1 − u), limitato a 1.00×–250.00×. Il seed viene pubblicato con ogni volo chiuso qui sotto — calcola l'hash da te e rifai i calcoli.",
      crashFairRow: "crash {crash}× · incassato {cashed}×",
      crashFairRowLoss: "crash {crash}×",
      crashFairSeed: "seed",
      crashAutoCustom: "Personalizzato",
    },
    leaderboards: {
      crashTopTitle: "Miglior incasso del razzo",
      crashTopDesc: "Il miglior moltiplicatore incassato in un singolo volo di Badge Rocket — nervi, non volume.",
      crashTopUnit: "Miglior incasso",
    },
    profile: {
      crashBestLine: "Miglior incasso su Badge Rocket: {mult}× (+{n} monete)",
      crashShareTitle: "Il miglior volo di {name} su Badge Rocket",
    },
  },
  pt: {
    games: {
      crashLive: "{n} foguetes no ar · top {mult}×",
      crashFairTitle: "Comprovadamente justo",
      crashFairBody:
        "O ponto de crash de cada voo é definido antes do lançamento: HMAC-SHA256(server seed, flight id) gera um número uniforme u (os primeiros 13 dígitos hex divididos por 2^52), e o ponto é 0.96 / (1 − u), limitado ao intervalo 1.00×–250.00×. A seed é publicada com cada voo encerrado abaixo — faça o hash você mesmo e refaça os cálculos.",
      crashFairRow: "crash em {crash}× · saque em {cashed}×",
      crashFairRowLoss: "crash em {crash}×",
      crashFairSeed: "seed",
      crashAutoCustom: "Personalizado",
    },
    leaderboards: {
      crashTopTitle: "Maior saque do Rocket",
      crashTopDesc: "O melhor multiplicador garantido em um único voo de Badge Rocket — nervo, não volume.",
      crashTopUnit: "Melhor saque",
    },
    profile: {
      crashBestLine: "Melhor saque no Badge Rocket: {mult}× (+{n} moedas)",
      crashShareTitle: "Melhor voo de {name} no Badge Rocket",
    },
  },
  ru: {
    games: {
      crashLive: "{n} ракет в воздухе · макс. {mult}×",
      crashFairTitle: "Доказуемо честная игра",
      crashFairBody:
        "Точка краша каждого полёта фиксируется до запуска: HMAC-SHA256(server seed, flight id) даёт равномерно распределённое число u (первые 13 hex-цифр, делённых на 2^52), а точка равна 0.96 / (1 − u) и ограничена диапазоном 1.00×–250.00×. Seed публикуется с каждым завершённым полётом ниже — посчитайте хеш сами и перепроверьте математику.",
      crashFairRow: "краш {crash}× · кэшаут {cashed}×",
      crashFairRowLoss: "краш {crash}×",
      crashFairSeed: "seed",
      crashAutoCustom: "Своё",
    },
    leaderboards: {
      crashTopTitle: "Наибольший кэшаут в Rocket",
      crashTopDesc: "Лучший зафиксированный множитель за один полёт в Badge Rocket — нервы, а не объём.",
      crashTopUnit: "Лучший кэшаут",
    },
    profile: {
      crashBestLine: "Лучший кэшаут в Badge Rocket: {mult}× (+{n} монет)",
      crashShareTitle: "Лучший полёт {name} в Badge Rocket",
    },
  },
  ar: {
    games: {
      crashLive: "{n} صواريخ في الجو · الأعلى {mult}×",
      crashFairTitle: "عدالة قابلة للإثبات",
      crashFairBody:
        "نقطة انفجار كل رحلة تُحدَّد قبل الإطلاق: HMAC-SHA256(server seed, flight id) تُنتج رقمًا موزّعًا بانتظام u (أول 13 خانة hex مقسومة على 2^52)، والنقطة هي 0.96 / (1 − u)، محصورة بين 1.00×–250.00×. يُنشر الـ seed مع كل رحلة محسومة أدناه — احسب الهاش بنفسك وأعد الحسابات.",
      crashFairRow: "انفجار عند {crash}× · سحب عند {cashed}×",
      crashFairRowLoss: "انفجار عند {crash}×",
      crashFairSeed: "seed",
      crashAutoCustom: "مخصص",
    },
    leaderboards: {
      crashTopTitle: "أعلى سحب في Rocket",
      crashTopDesc: "أفضل مضاعف محقَّق في رحلة واحدة من Badge Rocket — أعصاب، لا حجم.",
      crashTopUnit: "أفضل سحب",
    },
    profile: {
      crashBestLine: "أفضل سحب في Badge Rocket: {mult}× (+{n} عملة)",
      crashShareTitle: "أفضل رحلة لـ {name} في Badge Rocket",
    },
  },
  ja: {
    games: {
      crashLive: "ロケット {n} 機が飛行中 · 最高 {mult}×",
      crashFairTitle: "公平性証明（Provably Fair）",
      crashFairBody:
        "すべてのフライトのクラッシュポイントは打ち上げ前に確定しています。HMAC-SHA256(server seed, flight id) から一様な数値 u（先頭 13 桁の hex / 2^52）が得られ、ポイントは 0.96 / (1 − u) として算出され、1.00×–250.00× の範囲にクランプされます。シードは下の確定済みフライトごとに公開されるので、自分でハッシュして計算を再現できます。",
      crashFairRow: "クラッシュ {crash}× · キャッシュアウト {cashed}×",
      crashFairRowLoss: "クラッシュ {crash}×",
      crashFairSeed: "シード",
      crashAutoCustom: "カスタム",
    },
    leaderboards: {
      crashTopTitle: "ロケット最高キャッシュアウト",
      crashTopDesc: "1 回の Badge Rocket フライトで確定させた最高倍率 — 回数ではなく度胸の勝負。",
      crashTopUnit: "最高キャッシュアウト",
    },
    profile: {
      crashBestLine: "Badge Rocket の最高キャッシュアウト：{mult}×（+{n} コイン）",
      crashShareTitle: "{name} のベスト Badge Rocket フライト",
    },
  },
  ko: {
    games: {
      crashLive: "로켓 {n}기 비행 중 · 최고 {mult}×",
      crashFairTitle: "공정성 증명 (Provably Fair)",
      crashFairBody:
        "모든 플라이트의 크래시 지점은 발사 전에 확정됩니다. HMAC-SHA256(server seed, flight id)가 균등한 수 u(처음 13자리 hex / 2^52)를 생성하고, 지점은 0.96 / (1 − u)로 계산되어 1.00×–250.00× 범위로 클램프됩니다. 시드는 아래의 확정된 플라이트마다 함께 공개됩니다 — 직접 해시해서 계산을 재현해 보세요.",
      crashFairRow: "크래시 {crash}× · 캐시아웃 {cashed}×",
      crashFairRowLoss: "크래시 {crash}×",
      crashFairSeed: "시드",
      crashAutoCustom: "커스텀",
    },
    leaderboards: {
      crashTopTitle: "로켓 최고 캐시아웃",
      crashTopDesc: "단 한 번의 Badge Rocket 플라이트에서 확정한 최고 배율 — 횟수가 아닌 담력의 승부입니다.",
      crashTopUnit: "최고 캐시아웃",
    },
    profile: {
      crashBestLine: "Badge Rocket 최고 캐시아웃: {mult}× (+{n} 코인)",
      crashShareTitle: "{name}의 베스트 Badge Rocket 플라이트",
    },
  },
  zh: {
    games: {
      crashLive: "{n} 枚火箭飞行中 · 最高 {mult}×",
      crashFairTitle: "公平性证明 (Provably Fair)",
      crashFairBody:
        "每次飞行的坠机点在发射前就已确定：HMAC-SHA256(server seed, flight id) 生成均匀数 u（前 13 位 hex / 2^52），坠机点为 0.96 / (1 − u)，并被限制在 1.00×–250.00× 之间。种子会随下方每局已结算的飞行一同公布——你可以自己哈希并复现计算。",
      crashFairRow: "坠机 {crash}× · 兑现 {cashed}×",
      crashFairRowLoss: "坠机 {crash}×",
      crashFairSeed: "种子",
      crashAutoCustom: "自定义",
    },
    leaderboards: {
      crashTopTitle: "火箭最高兑现",
      crashTopDesc: "单次 Badge Rocket 飞行兑现的最高倍数——拼的是胆量，不是次数。",
      crashTopUnit: "最高兑现",
    },
    profile: {
      crashBestLine: "Badge Rocket 最高兑现：{mult}×（+{n} 金币）",
      crashShareTitle: "{name} 的最佳 Badge Rocket 飞行",
    },
  },
};

// [namespace, anchor key] — insertions land after the anchor; a missing
// anchor falls back to append-at-end (key-identity is what the checker
// enforces, not position).
const PLAN = [
  ["games", "crashHistory"],
  ["leaderboards", "wageredUnit"],
  ["profile", "monthShareTitle"],
];
const NEW_KEYS = {
  games: ["crashLive", "crashFairTitle", "crashFairBody", "crashFairRow", "crashFairRowLoss", "crashFairSeed", "crashAutoCustom"],
  leaderboards: ["crashTopTitle", "crashTopDesc", "crashTopUnit"],
  profile: ["crashBestLine", "crashShareTitle"],
};

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
  const canonical = `${JSON.stringify(parsed, null, 2).replace(/\n/g, "\r\n")}\r\n`;
  if (raw !== canonical) {
    console.error(`ABORT ${path}: not byte-identical to canonical stringify-2/CRLF`);
    failures += 1;
    continue;
  }
  const already = NEW_KEYS.games.concat(NEW_KEYS.leaderboards, NEW_KEYS.profile)
    .filter((key) => Object.prototype.hasOwnProperty.call(parsed.games ?? {}, key));
  if (already.length > 0) {
    console.error(`ABORT ${path}: already present: ${already.join(",")}`);
    failures += 1;
    continue;
  }

  for (const [ns, anchor] of PLAN) {
    const additions = {};
    for (const key of NEW_KEYS[ns]) additions[key] = T[locale][ns][key];
    parsed[ns] = insertAfter(parsed[ns] ?? {}, anchor, additions);
  }

  fs.writeFileSync(path, `${JSON.stringify(parsed, null, 2).replace(/\n/g, "\r\n")}\r\n`);

  const reread = JSON.parse(fs.readFileSync(path, "utf8"));
  const missing = [];
  for (const ns of Object.keys(NEW_KEYS)) {
    for (const key of NEW_KEYS[ns]) {
      if (typeof reread[ns]?.[key] !== "string") missing.push(`${ns}.${key}`);
    }
  }
  if (missing.length) {
    console.error(`FAIL ${path}: missing ${missing.join(",")}`);
    failures += 1;
  } else {
    console.log(`ok ${path} (+12 keys)`);
  }
}
if (failures > 0) {
  console.error(`\n${failures} file(s) FAILED`);
  process.exit(1);
}
console.log("\nall 11 locales updated (round 2)");
