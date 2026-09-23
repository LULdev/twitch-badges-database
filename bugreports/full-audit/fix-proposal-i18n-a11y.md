# Fix proposal — i18n & accessibility (`08-i18n-a11y.md`)

Proposal only; nothing was modified. Ordered by what a user notices first.
One correction to your adjudication is flagged up front.

## Correction before anything else

**B1's literal count is wrong.** `ProfileCustomizer.tsx` hard-codes **28** option
labels (8 `<select>`s, verified by parsing the file), not 33, and **4 placeholder
sites / 3 distinct translatable strings** (`"Badge Hunter"`, `"username"` ×2,
`"hunting SUBtember…"`). The 33 in the report does not correspond to any set I can
reconstruct. The *substance* of B1 is fully confirmed — every one of those 28
labels and 3 strings is a literal with no key — only the headline number is high.
So: B1 = CONFIRMED, count PARTIAL.

Everything else in the report's B2–B11 I re-derived against the code and agree
with, including the UAX#9 reasoning in B10 (the `+` is an ES neutral with no
preceding EN, so it resolves to the RTL paragraph direction and lands to the
*right* of the digit run) and the B8 focus mechanism (`disabled` on a focused
element blurs it to `<body>`).

**B11 (OG profile card) is out of scope of this proposal.** The report itself
calls it "a decision, not an oversight": the route has no locale input, so fixing
it means adding a locale parameter and passing it from the profile page. No key
is proposed for it here — it should be a separate, deliberate change.

---

## 1. New message keys

One key per distinct string; reused where an existing key already carries the
word. Namespace grouping keeps the 11 files key-identical and lets the whole
`options.*` subtree be added at once.

| Key | English value | Used by | New? |
|---|---|---|---|
| `common.breadcrumb` | `Breadcrumb` | `badges/[slug]`, `blog/[slug]` `aria-label` | new |
| `games.scatter` | `SCATTER!` | `SlotsGame.tsx` result line | new |
| `customizer.titlePlaceholder` | `Badge Hunter` | `COMMON_FIELDS.title` | new |
| `customizer.usernamePlaceholder` | `username` | `socialTwitter`, `socialDiscord` (one key, two sites) | new |
| `customizer.statusBubblePlaceholder` | `hunting SUBtember…` | `CREATIVE_FIELDS.statusBubble` | new |
| `customizer.options.font.sans` | `Sans` | | new |
| `customizer.options.font.serif` | `Serif` | | new |
| `customizer.options.font.mono` | `Mono` | | new |
| `customizer.options.font.rounded` | `Rounded` | | new |
| `customizer.options.cardStyle.glass` | `Glass` | | new |
| `customizer.options.cardStyle.solid` | `Solid` | | new |
| `customizer.options.cardStyle.outline` | `Outline` | | new |
| `customizer.options.radius.sharp` | `Sharp` | | new |
| `customizer.options.radius.soft` | `Soft` | | new |
| `customizer.options.radius.round` | `Round` | | new |
| `customizer.options.avatarFrame.none` | `None` | | new |
| `customizer.options.avatarFrame.ring` | `Ring` | | new |
| `customizer.options.avatarFrame.double` | `Double` | | new |
| `customizer.options.avatarFrame.glow` | `Glow` | | new |
| `customizer.options.avatarFrame.crown` | `Crown` | | new |
| `customizer.options.showcaseLayout.grid` | `Grid` | | new |
| `customizer.options.showcaseLayout.row` | `Row` | | new |
| `customizer.options.showcaseLayout.carousel` | `Carousel` | | new |
| `customizer.options.density.cozy` | `Cozy` | | new |
| `customizer.options.density.compact` | `Compact` | | new |
| `customizer.options.profileTheme.auto` | `Auto` | | new |
| `customizer.options.profileTheme.violet` | `Violet` | | new |
| `customizer.options.profileTheme.emerald` | `Emerald` | | new |
| `customizer.options.profileTheme.sapphire` | `Sapphire` | | new |
| `customizer.options.profileTheme.gold` | `Gold` | | new |
| `customizer.options.effectsIntensity.off` | `Off` | | new |
| `customizer.options.effectsIntensity.subtle` | `Subtle` | | new |
| `customizer.options.effectsIntensity.full` | `Full` | | new |

**Reused, not re-invented** (report is right on all three):
`common.new` (BadgeCard NEW chip), `games.spin` (wheel hub),
`changelog.rss` (changelog button). **Also reused:** `customizer.moodSection`
for the mood input's accessible name (item 6 below) — no key added.
`customizer.statusBubble` (the existing label) is *not* reused for the
placeholder, because it is the field's label and reads as a label, not an example.

33 new keys total (1 + 1 + 3 + 28). Every one is reachable.

Two entries are deliberately **identical in all eleven locales** and I am stating
that rather than inventing a "translation":

- `games.scatter` = `SCATTER!` — a slot symbol name. It is jargon that slot
  players read in English worldwide; localising it ("Streuer", "dispersion")
  would be wrong, not better. The value still belongs in the message files so it
  is centralised and sweepable.
- `customizer.options.font.sans/serif/mono` are font-category names and stay as
  Latin words in de/fr/es/pt/it; ru/zh/ja/ko/ar get the real native terms.

`customizer.nameGradient`'s placeholder `#a970ff,#60a5fa` is **not** translatable
(a hex example) and stays a literal — see the code note in §3.1.

---

## 2. Translations — merge into `messages/<locale>.json`

Merge these subtrees into each file; do not replace the file. The `customizer`
object already exists — add `options`, `titlePlaceholder`, `usernamePlaceholder`,
`statusBubblePlaceholder` inside it.

### en
```json
{
  "common": { "breadcrumb": "Breadcrumb" },
  "games": { "scatter": "SCATTER!" },
  "customizer": {
    "titlePlaceholder": "Badge Hunter",
    "usernamePlaceholder": "username",
    "statusBubblePlaceholder": "hunting SUBtember…",
    "options": {
      "font": { "sans": "Sans", "serif": "Serif", "mono": "Mono", "rounded": "Rounded" },
      "cardStyle": { "glass": "Glass", "solid": "Solid", "outline": "Outline" },
      "radius": { "sharp": "Sharp", "soft": "Soft", "round": "Round" },
      "avatarFrame": { "none": "None", "ring": "Ring", "double": "Double", "glow": "Glow", "crown": "Crown" },
      "showcaseLayout": { "grid": "Grid", "row": "Row", "carousel": "Carousel" },
      "density": { "cozy": "Cozy", "compact": "Compact" },
      "profileTheme": { "auto": "Auto", "violet": "Violet", "emerald": "Emerald", "sapphire": "Sapphire", "gold": "Gold" },
      "effectsIntensity": { "off": "Off", "subtle": "Subtle", "full": "Full" }
    }
  }
}
```

### de
```json
{
  "common": { "breadcrumb": "Pfadnavigation" },
  "games": { "scatter": "SCATTER!" },
  "customizer": {
    "titlePlaceholder": "Badge-Jäger",
    "usernamePlaceholder": "Benutzername",
    "statusBubblePlaceholder": "jagt SUBtember…",
    "options": {
      "font": { "sans": "Sans", "serif": "Serif", "mono": "Mono", "rounded": "Rund" },
      "cardStyle": { "glass": "Glas", "solid": "Deckend", "outline": "Umriss" },
      "radius": { "sharp": "Eckig", "soft": "Sanft", "round": "Rund" },
      "avatarFrame": { "none": "Keiner", "ring": "Ring", "double": "Doppelt", "glow": "Leuchten", "crown": "Krone" },
      "showcaseLayout": { "grid": "Raster", "row": "Reihe", "carousel": "Karussell" },
      "density": { "cozy": "Gemütlich", "compact": "Kompakt" },
      "profileTheme": { "auto": "Auto", "violet": "Violett", "emerald": "Smaragd", "sapphire": "Saphir", "gold": "Gold" },
      "effectsIntensity": { "off": "Aus", "subtle": "Dezent", "full": "Voll" }
    }
  }
}
```

### fr
```json
{
  "common": { "breadcrumb": "Fil d'Ariane" },
  "games": { "scatter": "SCATTER!" },
  "customizer": {
    "titlePlaceholder": "Chasseur de badges",
    "usernamePlaceholder": "nom d'utilisateur",
    "statusBubblePlaceholder": "chasse le SUBtember…",
    "options": {
      "font": { "sans": "Sans", "serif": "Serif", "mono": "Mono", "rounded": "Arrondi" },
      "cardStyle": { "glass": "Verre", "solid": "Plein", "outline": "Contour" },
      "radius": { "sharp": "Net", "soft": "Doux", "round": "Rond" },
      "avatarFrame": { "none": "Aucun", "ring": "Anneau", "double": "Double", "glow": "Lueur", "crown": "Couronne" },
      "showcaseLayout": { "grid": "Grille", "row": "Ligne", "carousel": "Carrousel" },
      "density": { "cozy": "Confortable", "compact": "Compact" },
      "profileTheme": { "auto": "Auto", "violet": "Violet", "emerald": "Émeraude", "sapphire": "Saphir", "gold": "Or" },
      "effectsIntensity": { "off": "Désactivé", "subtle": "Subtil", "full": "Complet" }
    }
  }
}
```

### es
```json
{
  "common": { "breadcrumb": "Ruta de navegación" },
  "games": { "scatter": "SCATTER!" },
  "customizer": {
    "titlePlaceholder": "Cazador de insignias",
    "usernamePlaceholder": "nombre de usuario",
    "statusBubblePlaceholder": "cazando el SUBtember…",
    "options": {
      "font": { "sans": "Sans", "serif": "Serif", "mono": "Mono", "rounded": "Redondeada" },
      "cardStyle": { "glass": "Cristal", "solid": "Sólido", "outline": "Contorno" },
      "radius": { "sharp": "Afilado", "soft": "Suave", "round": "Redondo" },
      "avatarFrame": { "none": "Ninguno", "ring": "Anillo", "double": "Doble", "glow": "Resplandor", "crown": "Corona" },
      "showcaseLayout": { "grid": "Cuadrícula", "row": "Fila", "carousel": "Carrusel" },
      "density": { "cozy": "Cómoda", "compact": "Compacta" },
      "profileTheme": { "auto": "Auto", "violet": "Violeta", "emerald": "Esmeralda", "sapphire": "Zafiro", "gold": "Oro" },
      "effectsIntensity": { "off": "Desactivado", "subtle": "Sutil", "full": "Completo" }
    }
  }
}
```

### pt
```json
{
  "common": { "breadcrumb": "Trilha de navegação" },
  "games": { "scatter": "SCATTER!" },
  "customizer": {
    "titlePlaceholder": "Caçador de badges",
    "usernamePlaceholder": "nome de usuário",
    "statusBubblePlaceholder": "caçando o SUBtember…",
    "options": {
      "font": { "sans": "Sans", "serif": "Serif", "mono": "Mono", "rounded": "Arredondada" },
      "cardStyle": { "glass": "Vidro", "solid": "Sólido", "outline": "Contorno" },
      "radius": { "sharp": "Afiado", "soft": "Suave", "round": "Redondo" },
      "avatarFrame": { "none": "Nenhum", "ring": "Anel", "double": "Duplo", "glow": "Brilho", "crown": "Coroa" },
      "showcaseLayout": { "grid": "Grade", "row": "Linha", "carousel": "Carrossel" },
      "density": { "cozy": "Confortável", "compact": "Compacto" },
      "profileTheme": { "auto": "Automático", "violet": "Violeta", "emerald": "Esmeralda", "sapphire": "Safira", "gold": "Dourado" },
      "effectsIntensity": { "off": "Desligado", "subtle": "Sutil", "full": "Completo" }
    }
  }
}
```

### it
```json
{
  "common": { "breadcrumb": "Percorso di navigazione" },
  "games": { "scatter": "SCATTER!" },
  "customizer": {
    "titlePlaceholder": "Cacciatore di badge",
    "usernamePlaceholder": "nome utente",
    "statusBubblePlaceholder": "a caccia di SUBtember…",
    "options": {
      "font": { "sans": "Sans", "serif": "Serif", "mono": "Mono", "rounded": "Arrotondato" },
      "cardStyle": { "glass": "Vetro", "solid": "Pieno", "outline": "Contorno" },
      "radius": { "sharp": "Spigoloso", "soft": "Morbido", "round": "Tondo" },
      "avatarFrame": { "none": "Nessuno", "ring": "Anello", "double": "Doppio", "glow": "Bagliore", "crown": "Corona" },
      "showcaseLayout": { "grid": "Griglia", "row": "Riga", "carousel": "Carosello" },
      "density": { "cozy": "Ampia", "compact": "Compatta" },
      "profileTheme": { "auto": "Auto", "violet": "Viola", "emerald": "Smeraldo", "sapphire": "Zaffiro", "gold": "Oro" },
      "effectsIntensity": { "off": "Disattivato", "subtle": "Sottile", "full": "Completo" }
    }
  }
}
```

### ru
```json
{
  "common": { "breadcrumb": "Навигационная цепочка" },
  "games": { "scatter": "SCATTER!" },
  "customizer": {
    "titlePlaceholder": "Охотник за бейджами",
    "usernamePlaceholder": "имя пользователя",
    "statusBubblePlaceholder": "охочусь на SUBtember…",
    "options": {
      "font": { "sans": "Без засечек", "serif": "С засечками", "mono": "Моно", "rounded": "Округлый" },
      "cardStyle": { "glass": "Стекло", "solid": "Плотный", "outline": "Контур" },
      "radius": { "sharp": "Острые", "soft": "Мягкие", "round": "Круглые" },
      "avatarFrame": { "none": "Нет", "ring": "Кольцо", "double": "Двойная", "glow": "Свечение", "crown": "Корона" },
      "showcaseLayout": { "grid": "Сетка", "row": "Ряд", "carousel": "Карусель" },
      "density": { "cozy": "Просторная", "compact": "Компактная" },
      "profileTheme": { "auto": "Авто", "violet": "Фиолетовая", "emerald": "Изумрудная", "sapphire": "Сапфировая", "gold": "Золотая" },
      "effectsIntensity": { "off": "Выкл.", "subtle": "Лёгкие", "full": "Полные" }
    }
  }
}
```

### zh
```json
{
  "common": { "breadcrumb": "面包屑导航" },
  "games": { "scatter": "SCATTER!" },
  "customizer": {
    "titlePlaceholder": "徽章猎人",
    "usernamePlaceholder": "用户名",
    "statusBubblePlaceholder": "正在蹲 SUBtember…",
    "options": {
      "font": { "sans": "无衬线", "serif": "衬线", "mono": "等宽", "rounded": "圆体" },
      "cardStyle": { "glass": "玻璃", "solid": "实心", "outline": "描边" },
      "radius": { "sharp": "直角", "soft": "柔和", "round": "圆角" },
      "avatarFrame": { "none": "无", "ring": "圆环", "double": "双层", "glow": "辉光", "crown": "皇冠" },
      "showcaseLayout": { "grid": "网格", "row": "横排", "carousel": "轮播" },
      "density": { "cozy": "宽松", "compact": "紧凑" },
      "profileTheme": { "auto": "自动", "violet": "紫色", "emerald": "翠绿", "sapphire": "蓝宝石", "gold": "金色" },
      "effectsIntensity": { "off": "关闭", "subtle": "轻微", "full": "全开" }
    }
  }
}
```

### ja
```json
{
  "common": { "breadcrumb": "パンくずリスト" },
  "games": { "scatter": "SCATTER!" },
  "customizer": {
    "titlePlaceholder": "バッジハンター",
    "usernamePlaceholder": "ユーザー名",
    "statusBubblePlaceholder": "SUBtember を狙ってます…",
    "options": {
      "font": { "sans": "サンセリフ", "serif": "セリフ", "mono": "等幅", "rounded": "丸ゴシック" },
      "cardStyle": { "glass": "ガラス", "solid": "ソリッド", "outline": "アウトライン" },
      "radius": { "sharp": "シャープ", "soft": "ソフト", "round": "ラウンド" },
      "avatarFrame": { "none": "なし", "ring": "リング", "double": "二重", "glow": "グロー", "crown": "クラウン" },
      "showcaseLayout": { "grid": "グリッド", "row": "リスト", "carousel": "カルーセル" },
      "density": { "cozy": "ゆったり", "compact": "コンパクト" },
      "profileTheme": { "auto": "自動", "violet": "バイオレット", "emerald": "エメラルド", "sapphire": "サファイア", "gold": "ゴールド" },
      "effectsIntensity": { "off": "オフ", "subtle": "控えめ", "full": "フル" }
    }
  }
}
```

### ko
```json
{
  "common": { "breadcrumb": "이동 경로" },
  "games": { "scatter": "SCATTER!" },
  "customizer": {
    "titlePlaceholder": "배지 헌터",
    "usernamePlaceholder": "사용자 이름",
    "statusBubblePlaceholder": "SUBtember 사냥 중…",
    "options": {
      "font": { "sans": "산세리프", "serif": "세리프", "mono": "고정폭", "rounded": "둥근" },
      "cardStyle": { "glass": "유리", "solid": "단색", "outline": "윤곽" },
      "radius": { "sharp": "각진", "soft": "부드러운", "round": "원형" },
      "avatarFrame": { "none": "없음", "ring": "링", "double": "이중", "glow": "광채", "crown": "왕관" },
      "showcaseLayout": { "grid": "그리드", "row": "행", "carousel": "캐러셀" },
      "density": { "cozy": "넉넉함", "compact": "조밀함" },
      "profileTheme": { "auto": "자동", "violet": "보라", "emerald": "에메랄드", "sapphire": "사파이어", "gold": "골드" },
      "effectsIntensity": { "off": "끔", "subtle": "은은함", "full": "가득" }
    }
  }
}
```

### ar
```json
{
  "common": { "breadcrumb": "مسار التنقل" },
  "games": { "scatter": "SCATTER!" },
  "customizer": {
    "titlePlaceholder": "صائد الشارات",
    "usernamePlaceholder": "اسم المستخدم",
    "statusBubblePlaceholder": "أطارد SUBtember…",
    "options": {
      "font": { "sans": "بدون زخرفة", "serif": "مزخرف", "mono": "أحادي المسافة", "rounded": "مستدير" },
      "cardStyle": { "glass": "زجاجي", "solid": "صلب", "outline": "محدد" },
      "radius": { "sharp": "حاد", "soft": "ناعم", "round": "دائري" },
      "avatarFrame": { "none": "بدون", "ring": "حلقة", "double": "مزدوج", "glow": "توهج", "crown": "تاج" },
      "showcaseLayout": { "grid": "شبكة", "row": "صف", "carousel": "عرض دوّار" },
      "density": { "cozy": "فسيحة", "compact": "مضغوطة" },
      "profileTheme": { "auto": "تلقائي", "violet": "بنفسجي", "emerald": "زمردي", "sapphire": "ياقوتي", "gold": "ذهبي" },
      "effectsIntensity": { "off": "متوقف", "subtle": "خفيف", "full": "كامل" }
    }
  }
}
```

---

## 3. Code replacements

### 3.1 `src/components/account/ProfileCustomizer.tsx` (B1 + B9)

**a) The `Field` type** (line 70–75) — add a translatable-placeholder field and
keep `placeholder` for the non-translatable hex example:

```tsx
type Field =
  | { key: keyof Customization; kind: "text"; label: string; placeholder?: string; placeholderKey?: string }
  | { key: keyof Customization; kind: "color"; label: string }
  | { key: keyof Customization; kind: "toggle"; label: string; hint?: string }
  | { key: keyof Customization; kind: "select"; label: string; options: Array<[string, string]> }
  | { key: keyof Customization; kind: "range"; label: string; min: number; max: number };
```

**b) `COMMON_FIELDS`** (lines 77–99) — replace the eight lines that carry a
literal label or placeholder:

```tsx
  { key: "title", kind: "text", label: "title", placeholderKey: "titlePlaceholder" },
```
```tsx
  { key: "font", kind: "select", label: "font", options: [["sans", "options.font.sans"], ["serif", "options.font.serif"], ["mono", "options.font.mono"], ["rounded", "options.font.rounded"]] },
  { key: "cardStyle", kind: "select", label: "cardStyle", options: [["glass", "options.cardStyle.glass"], ["solid", "options.cardStyle.solid"], ["outline", "options.cardStyle.outline"]] },
  { key: "radius", kind: "select", label: "radius", options: [["sharp", "options.radius.sharp"], ["soft", "options.radius.soft"], ["round", "options.radius.round"]] },
```
```tsx
  { key: "avatarFrame", kind: "select", label: "avatarFrame", options: [["none", "options.avatarFrame.none"], ["ring", "options.avatarFrame.ring"], ["double", "options.avatarFrame.double"], ["glow", "options.avatarFrame.glow"], ["crown", "options.avatarFrame.crown"]] },
```
```tsx
  { key: "showcaseLayout", kind: "select", label: "showcaseLayout", options: [["grid", "options.showcaseLayout.grid"], ["row", "options.showcaseLayout.row"], ["carousel", "options.showcaseLayout.carousel"]] },
```
```tsx
  { key: "socialTwitter", kind: "text", label: "socialTwitter", placeholderKey: "usernamePlaceholder" },
  { key: "socialDiscord", kind: "text", label: "socialDiscord", placeholderKey: "usernamePlaceholder" },
  { key: "density", kind: "select", label: "density", options: [["cozy", "options.density.cozy"], ["compact", "options.density.compact"]] },
```

Line 87 (`nameGradient`) is **unchanged**: `placeholder: "#a970ff,#60a5fa"` stays
a literal — it is a hex example, not UI copy.

**c) `CREATIVE_FIELDS`** (lines 112–114):

```tsx
  { key: "statusBubble", kind: "text", label: "statusBubble", placeholderKey: "statusBubblePlaceholder" },
  { key: "profileTheme", kind: "select", label: "profileTheme", options: [["auto", "options.profileTheme.auto"], ["violet", "options.profileTheme.violet"], ["emerald", "options.profileTheme.emerald"], ["sapphire", "options.profileTheme.sapphire"], ["gold", "options.profileTheme.gold"]] },
  { key: "effectsIntensity", kind: "select", label: "effectsIntensity", options: [["off", "options.effectsIntensity.off"], ["subtle", "options.effectsIntensity.subtle"], ["full", "options.effectsIntensity.full"]] },
```

**d) The `text` render branch** (line 178) — resolve the key, fall back to the raw
literal for the hex case:

```tsx
              placeholder={field.placeholderKey ? t(field.placeholderKey) : field.placeholder}
```

**e) The `select` render branch** (lines 224–226) — the second tuple member is now
a key relative to the `customizer` namespace:

```tsx
              {field.options.map(([optionValue, optionLabel]) => (
                <option key={optionValue} value={optionValue}>{t(optionLabel)}</option>
              ))}
```

**f) Mood input (B9)** — give it the section heading as its accessible name, reusing
the existing key (lines 267–273):

```tsx
        <input
          className="input"
          value={mood}
          maxLength={60}
          placeholder={t("statusBubble")}
          aria-label={t("moodSection")}
          onChange={(event) => setMood(event.target.value)}
        />
```

### 3.2 `src/components/badges/BadgeCard.tsx` (B2)

`t` is `getTranslations("badges")`; `common.new` lives in `common`. Add a second
translator after line 56 (`const t = await getTranslations("badges");`):

```tsx
  const tc = await getTranslations("common");
```

Then replace the literal at line 74:

```tsx
              {tc("new")}
```

### 3.3 `src/components/WheelOfFortune.tsx` (B3)

After line 30 add:

```tsx
  const tg = useTranslations("games");
```

(`wheel.spin` is "Spin now"/"أدر الآن" — the button's string. The hub wants the
short slot label that lives in `games.spin`.) Replace the literal at line 119:

```tsx
          {tg("spin")}
```

### 3.4 `src/app/[locale]/changelog/page.tsx` (B5a)

Replace the visible literal `RSS` at line 97 with the same key already used for the
`title` on that anchor (line 90):

```tsx
          {t("rss")}
```

### 3.5 `src/components/games/SlotsGame.tsx` (B5b)

Line 107 — replace the literal:

```tsx
                ? (<span dir="ltr">{`+${(lastWin.payout - bet).toLocaleString(locale)}`}</span> <Coin size={14} /> — {lastWin.lines} {t("paylines")}{lastWin.scatter >= 3 ? ` · ${lastWin.scatter}x ${t("scatter")}` : ""})
```

(That line carries the RTL fix from §3.10 as well — see below.)

### 3.6 `src/app/[locale]/badges/[slug]/page.tsx` (B4a)

Line 121 — `tc` is already `getTranslations("common")`:

```tsx
      <nav className="text-xs text-muted" aria-label={tc("breadcrumb")}>
```

### 3.7 `src/app/[locale]/blog/[slug]/page.tsx` (B4b)

This page's only translator is `getTranslations("blog")` (line 47); the key lives
in `common`. Add a translator next to it:

```tsx
  const tc = await getTranslations("common");
```

Line 97:

```tsx
      <nav className="text-xs text-muted" aria-label={tc("breadcrumb")}>
```

### 3.8 `src/components/Header.tsx` (B7)

Desktop nav (lines 119–130) — add one attribute to the `Link`:

```tsx
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              className={`rounded-lg px-2.5 py-1.5 text-[0.8125rem] font-semibold transition-colors ${
                isActive(link.href)
                  ? "text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
```

Mobile nav (lines 250–258) — it currently uses a fixed muted class and no active
state; add the attribute so AT still gets the current page (no visual change
needed):

```tsx
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-foreground"
                onClick={() => setMenuOpen(false)}
              >
```

`isActive()` already exists at line 65; this only emits the information it
computes.

### 3.9 `src/components/LanguageSwitcher.tsx` (B8)

**The ordering problem.** `select()` (line 124) deliberately returns focus to the
trigger (`triggerRef.current?.focus()`, line 126) *before* `startTransition` runs
`router.replace`. But the trigger carries `disabled={isPending}` (line 179), and
`isPending` flips to `true` on the very next render, while the trigger holds focus.
A focused element that becomes `disabled` is blurred by the browser and focus
falls to `<body>`. So the explicit focus() is undone by the `disabled` attribute —
the intent and the attribute fight each other.

**The fix** is to stop disabling the focused control and gate re-entry in JS
instead. `aria-disabled` is announced but stays focusable, so focus survives the
transition; the spinner/dim visuals are already driven by the `.is-pending` class
(`globals.css:1573,1577`), not by `:disabled`, so nothing visual is lost.

Line 176–180, replace the `onClick` and `disabled`:

```tsx
        onClick={() => { if (!isPending) setOpen((value) => !value); }}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="lang-listbox"
        aria-label={`${t("language")}: ${localeNames[locale as Locale] ?? locale}`}
        aria-disabled={isPending}
```

Line 138 (`onKeyDown`), guard the handler:

```tsx
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (isPending) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
```

No change is needed in `select()` itself: with the trigger no longer disabled,
`triggerRef.current?.focus()` sticks.

### 3.10 RTL sign — `FeedList.tsx`, `WheelOfFortune.tsx`, `SlotsGame.tsx` (B10)

`+`/`-` is bidi-neutral; in an RTL paragraph with no strong LTR neighbour it
resolves to RTL and is painted at the *right* end of the digit run, so `+1,234`
reads `1,234+` in Arabic. The fix is to make the numeric island explicitly LTR.

`src/components/FeedList.tsx:139–142` — the span contains only the sign, the
number and the `<Coin>` SVG, so mark the span itself LTR:

```tsx
                  <span dir="ltr" className={`inline-flex items-center gap-1 font-bold ${event.coins_amount > 0 ? "text-success" : "text-danger"}`}>
                    {event.coins_amount > 0 ? "+" : ""}{event.coins_amount.toLocaleString(locale)} <Coin size={12} />
                  </span>
```

`src/components/WheelOfFortune.tsx:137` — same shape:

```tsx
              {result.turbo ? t("turboWon") : (<span dir="ltr" className="inline-flex items-center gap-1.5">+{result.coins.toLocaleString(locale)} <Coin size={16} className="bcoin-lg" /></span>)}
```

`src/components/games/SlotsGame.tsx:107` — this line also contains the *translated*
word `paylines` and the `scatter` key, so `dir="ltr"` on the whole span would
mis-place the Arabic word. Isolate only the leading amount (shown already in
§3.5):

```tsx
                ? (<span><span dir="ltr">{`+${(lastWin.payout - bet).toLocaleString(locale)}`}</span> <Coin size={14} /> — {lastWin.lines} {t("paylines")}{lastWin.scatter >= 3 ? ` · ${lastWin.scatter}x ${t("scatter")}` : ""}</span>)
```

### 3.11 `src/components/games/CatcherGame.tsx` and `ShootGame.tsx` (B6)

**Catcher — a real keyboard path is reasonable and cheap.** The basket moves on one
axis, so Arrow Left/Right maps onto it directly, and the same change removes the
touch bug the report noted (`onMouseMove` never fires for touch/pen).

Replace `move` (lines 115–121) and add a key handler:

```tsx
  function move(event: React.PointerEvent<HTMLDivElement>) {
    if (!running) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    setBasketX(x);
    stateRef.current.basketX = x;
  }

  function nudge(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!running) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -6 : 6;
    const next = Math.min(95, Math.max(5, stateRef.current.basketX + delta));
    setBasketX(next);
    stateRef.current.basketX = next;
  }
```

Focus the field when a round starts (end of `start()`, line 131):

```tsx
    setRunning(true);
    areaRef.current?.focus();
```

The play area (lines 138–141):

```tsx
      <div
        ref={areaRef}
        tabIndex={0}
        role="application"
        aria-label={t("catcherTitle")}
        onPointerMove={move}
        onKeyDown={nudge}
        className="relative h-80 select-none overflow-hidden rounded-[var(--radius-card)] border border-line bg-gradient-to-b from-background to-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
```

`role="application"` is the correct role for a self-contained interactive play
field: it tells AT to hand keystrokes to the page instead of interpreting them as
navigation, which is exactly what a game with its own arrow-key controls needs.
`t("catcherTitle")` (already in `games`) gives the area a name without a new key.

**Shoot — an honest answer: a full keyboard path is not reasonable, and I would
not ship one.** The only faithful keyboard equivalent is an arrow-key crosshair
moving in 2D plus Space to fire; that is a second input system bolted onto a
30-second reflex game where targets spawn at random x/y and drift, and a keyboard
player steering a crosshair would be so much slower than a pointer that the game
would be effectively unwinnable while still charging a bet. That is not
accessibility, it is a worse game. My recommendation is to declare `ShootGame`
pointer-only and record the limitation. If you want parity anyway, the honest
substitute is *not* a crosshair but an auto-aim: while running, `Space` fires at
the nearest target within the existing 30px hit radius. That is a deliberate
game-design change (it makes keyboard play easier than pointer play), so it should
be your call, not mine; the minimal version of it is:

```tsx
  // optional auto-aim; only if you accept the balance change
  function shootNearest() {
    if (!running || targetsRef.current.length === 0) return;
    stateRef.current.shots += 1;
    setShots((prev) => prev + 1);
    const next = [...targetsRef.current];
    next.splice(0, 1); // nearest-first ordering would go here
    targetsRef.current = next;
    stateRef.current.hits += 1;
    setHits(stateRef.current.hits);
    setTargets(next);
  }
```

I am **not** proposing this as part of the fix; I am naming it as the only path if
you decide Shoot must be keyboard-playable. Otherwise, no code change for Shoot.

---

## 4. How to verify

### i18n key parity (the mechanical check)

After merging, run this against `messages/`; it must report `missing 0 extra 0`
for all ten non-`en` locales (and will catch a key you added to one file only):

```
node -e "const fs=require('fs');const L=['en','de','fr','es','pt','it','ru','zh','ja','ko','ar'];const flat=(o,p='')=>Object.entries(o).flatMap(([k,v])=>v&&typeof v==='object'?flat(v,p?p+'.'+k:k):[p?p+'.'+k:k]);const base=new Set(flat(JSON.parse(fs.readFileSync('messages/en.json','utf8'))));let bad=0;for(const l of L){const s=new Set(flat(JSON.parse(fs.readFileSync('messages/'+l+'.json','utf8'))));const miss=[...base].filter(k=>!s.has(k));const extra=[...s].filter(k=>!base.has(k));if(miss.length||extra.length)bad++;console.log(l,'missing',miss.length,'extra',extra.length,miss,extra)}process.exit(bad?1:0)"
```

Then `npm run lint && npm run typecheck && npm run build`, and **read the build log
for `MISSING_MESSAGE`** — next-intl throws at render for an unknown key but the
build still succeeds, so the log is the only place it shows (AGENTS.md gotcha).

Spot-check that the new keys actually resolve (a key that exists but is never
`t()`ed passes parity): open `/de/account` and confirm the selects read German
("Deckend", "Gemütlich", "Krone"), the title placeholder reads "Badge-Jäger", and
`/ar/account` renders RTL with Arabic option labels; open `/ja/games/slots` and a
winning line ends in `3x SCATTER!`.

### Per a11y item — what to look at

- **B2 (NEW chip)** — open `/de/badges` while a badge with `first_seen_at` within
  14 days exists; the chip reads "Neu", not "NEW". Repeat `/ja/badges` → "新着".
- **B3 (SPIN)** — open `/fr/wheel`; the hub reads "TOURNER", the button below
  reads "Tourner maintenant". No English "SPIN" anywhere on `/ar/wheel`.
- **B5 (RSS + SCATTER)** — `/de/changelog`: the button reads "RSS-Feed" and its
  tooltip says the same. `/ja/games/slots`: a payout line shows `3x SCATTER!`.
- **B4 (breadcrumb)** — on `/de/badges/<slug>` and `/de/blog/<any>`, use an AT
  landmark list; the nav is announced as "Pfadnavigation", not "Breadcrumb".
- **B9 (mood input)** — on `/en/account`, with an AT, the field under "Mood
  status" is announced as an edit box named "Mood status".
- **B7 (aria-current)** — inspect any nav link on `/de/badges`: the current one
  carries `aria-current="page"`; on a detail page `/badges/<slug>`, the "Badges"
  nav entry is the current one. Check the mobile menu at a narrow width too.
- **B8 (language focus)** — keyboard only: Tab to the flag button, Arrow Down,
  Arrow Down, Enter. After the page settles, `document.activeElement` must be the
  flag button, **not** `<body>`. Before the fix it is `<body>`.
- **B6 (catcher keyboard)** — `/en/games/catcher`: Tab into the play field (focus
  ring visible), press Start/Enter, then press Arrow Left/Right — the basket moves
  in 6% steps and clamps at the edges. On a touch device (or DevTools touch
  emulation) drag inside the field — the basket follows (this did not work before).
  `/en/games/shoot`: confirm you accepted the pointer-only decision (no keyboard
  claim is made).
- **B10 (RTL sign)** — `/ar/feed`: a coin event must show the `+` on the **left**
  of the number (`+1,234`), not `1,234+`. Same on `/ar/wheel` after a spin and on
  `/ar/games/slots` after a win.

---

## 5. Order to apply

1. §2 keys for all 11 locales, then the parity script (cheap, no behaviour change).
2. §3.1 (customizer) — the one change ten locales notice.
3. §3.2, §3.3, §3.4, §3.5 — the four small visible literals.
4. §3.6–3.8, §3.9 — breadcrumb, aria-current, language focus.
5. §3.10, §3.11 — RTL sign, catcher keyboard.
6. `npm run lint && npm run typecheck && npm run build`, then the build-log check.
7. `npm run log:change -- bugfix "i18n and accessibility fixes" "<one paragraph>"`
   — the changelog entry AGENTS.md requires for every change.
