# Unicode

This is the file that breaks viewers.

The rule it exists to enforce is simple to state and easy to get wrong: layout
measures **display cells**, never `String.length`. A CJK ideograph is two cells
and one character. An emoji is two cells and two characters. A combining accent
is zero cells and one character. A flag is two cells and four. Any code that
adds up characters and calls the total a width will draw a border in the wrong
column, and the error compounds down the page.

Worse, width is not even a property of a single character. `U+FE0F` — the
variation selector — widens the glyph *before* it. So a scanner has to advance
by cluster, a base plus the marks bound to it, and never by code point.

## Chinese

中文段落应当正确换行，因为每个汉字占据两个终端字符宽度。用字符数来排版，
会让所有对齐悄悄地坏掉：表格的竖线会错位，代码块的右边框会落在字里面，
而这些错误会一行一行地累积下去。

简体和繁體都是两格宽。這一段是繁體中文，同樣需要按照顯示寬度來換行，
不能按照字元數量。標點符號也一樣：「引號」、《書名號》、—— 破折號，
全形句號。

标点符号的宽度是一个真实的陷阱。全角逗号，全角句号。半角逗号, 半角句号.
两者看起来相似，宽度却不同。

## Japanese

日本語のテキストも同じです。全角文字は二セル分の幅を持ちます。ひらがな、
カタカナ、漢字のいずれも同様です。

半角カタカナ（ﾊﾝｶｸ ｶﾀｶﾅ）は一セル幅で、全角カタカナ（ハンカク カタカナ）は
二セル幅です。同じ文字に見えて幅が違うので、文字数で数えると必ずずれます。

長音符（ー）、促音（っ）、拗音（ゃゅょ）、それに句読点（、。）も
すべて全角です。

## Korean

한국어 텍스트도 마찬가지입니다. 한글 음절은 두 칸을 차지합니다.
자음과 모음이 결합된 하나의 음절이 한 글자이며, 터미널에서는 두 셀 너비로
그려집니다.

자모를 따로 쓰면(ㄱ ㄴ ㄷ ㅏ ㅑ ㅓ) 이것들도 각각 두 칸입니다.
띄어쓰기가 있는 언어라서 줄바꿈은 영어와 비슷하게 동작합니다.

## Emoji

Plain emoji are two cells each: 🚀 ✅ 🎉 🔥 📦 🐛 🧪 📊 🎯 💡

Some characters are emoji only when a variation selector says so. `⚠` on its
own is a narrow text symbol; `⚠️` — the same character followed by `U+FE0F` —
is a wide emoji. Compare the two columns below, which should be one cell and
two cells respectively:

| Text form | Emoji form | Name |
|:---:|:---:|:---|
| ⚠ | ⚠️ | warning sign |
| ✔ | ✔️ | heavy check mark |
| ☀ | ☀️ | sun |
| ☁ | ☁️ | cloud |
| ✂ | ✂️ | scissors |
| ❤ | ❤️ | heart |
| ⭐ | ⭐ | star (always wide) |
| ▶ | ▶️ | play button |

### Zero-width joiner sequences

A ZWJ sequence glues several emoji into one glyph with a zero-width joiner
between each pair. Every modern terminal draws the result as a single two-cell
glyph, however many code points went into it — which is the case that catches
every width function that adds up code points instead of clusters. It is also
the case terminals themselves disagree about most, so if a row below does not
line up, check what your terminal drew before blaming the viewer.

| Sequence | Code points | Cells |
|:---|---:|---:|
| 👩‍💻 woman technologist | 3 | 2 |
| 👨‍🚀 man astronaut | 3 | 2 |
| 👩‍🔬 woman scientist | 3 | 2 |
| 👨‍👩‍👧‍👦 family of four | 7 | 2 |
| 👩‍❤️‍💋‍👨 kiss | 8 | 2 |
| 🏳️‍🌈 rainbow flag | 4 | 2 |
| 🏴‍☠️ pirate flag | 4 | 2 |
| 🧑‍🤝‍🧑 people holding hands | 3 | 2 |

### Skin tone modifiers

A modifier attaches to the base emoji and does not add width:
👋 👋🏻 👋🏼 👋🏽 👋🏾 👋🏿 — six glyphs, twelve cells, and rather more code points
than that.

Combined with a ZWJ sequence, both apply at once: 👩🏽‍💻 👨🏿‍🚀 👩🏻‍🔬.

### Regional indicator flags

A flag is two regional indicator letters, which are four code points and two
cells: 🇯🇵 🇰🇷 🇨🇳 🇬🇧 🇺🇸 🇩🇪 🇫🇷 🇧🇷 🇮🇳 🇳🇬

Written out, `🇯🇵` is `U+1F1EF U+1F1F5`. Neither half is a flag by itself.

## Combining marks

A combining mark is zero cells wide and must never be separated from the base
it modifies. A wrap or a horizontal slice that cuts between them produces a
stray accent floating on its own, which is the visual equivalent of a crash.

| Composed | Decomposed | Looks the same? |
|:---|:---|:---:|
| é (U+00E9) | é (e + U+0301) | yes |
| ñ (U+00F1) | ñ (n + U+0303) | yes |
| ô (U+00F4) | ô (o + U+0302) | yes |
| Å (U+00C5) | Å (A + U+030A) | yes |
| ự (U+1EF1) | ự (u + U+031B + U+0323) | yes |

Vietnamese stacks two marks on one base routinely: Tiếng Việt, một ngôn ngữ
với rất nhiều dấu, và mỗi dấu là không ô nào cả.

Devanagari combines differently again — क + ि = कि, and the vowel sign is drawn
to the *left* of the consonant it follows in memory: हिन्दी, नमस्ते, धन्यवाद.

And then there is the case everyone tests with: Z̸͎̈a̷̯͐l̶̢̈g̵̙̈o̴͇͝ text, which is a base
character with an unreasonable number of combining marks. It is zero extra
cells and a great deal of extra code points.

## Right-to-left text

Arabic and Hebrew are written right to left. A terminal handles that at display
time with its own bidirectional algorithm, and a layout engine has no business
trying to reorder anything — its job is to measure correctly and to not cut a
run in a place that changes its meaning.

Arabic, which also joins its letters contextually so the same letter has
several shapes:

> العربية لغة تكتب من اليمين إلى اليسار. الحروف تتصل ببعضها البعض،
> وشكل الحرف يتغير حسب موضعه في الكلمة.

Hebrew, which does not join but does put vowel points below the letters:

> עברית נכתבת מימין לשמאל. הניקוד נמצא מתחת לאותיות ואינו תופס רוחב.

Mixed direction in one line is the genuinely hard case, because the run
boundaries are where a terminal's rendering and a layout engine's arithmetic
are most likely to disagree:

- The package is called `@ziweiwu/folio` — بالعربية يسمى فوليو — and it is a pager.
- Version 0.3.1 (גרסה 0.3.1) shipped on 2026-08-26.
- Run `folio README.md` (شغّل الأمر) and press `q` (اضغط) to quit.

There is one thing folio deliberately does *not* pass through: an explicit
bidirectional override. A document that can reorder the characters around it
can make a command line read as something other than what it would run, and
that is the document driving the terminal rather than describing itself.

## Mathematical symbols

Most are narrow, a few are wide, and the difference is not guessable:

∀ x ∈ ℝ, ∃ δ > 0 : |x − a| < δ ⟹ |f(x) − f(a)| < ε

∑ᵢ₌₁ⁿ xᵢ ≈ ∫₀^∞ f(t) dt, subject to ∇²φ = 0 and ‖v‖₂ ≤ 1

| Symbol | Name | Cells |
|:---:|:---|---:|
| ∀ ∃ ∄ | quantifiers | 1 |
| ∈ ∉ ⊂ ⊆ ⊇ | set relations | 1 |
| ≤ ≥ ≠ ≈ ≡ | comparisons | 1 |
| ± × ÷ ∓ | arithmetic | 1 |
| ∑ ∏ ∫ ∮ | operators | 1 |
| √ ∛ ∜ | roots | 1 |
| α β γ δ ε | Greek letters | 1 |
| ℝ ℂ ℕ ℤ ℚ | number sets | 1 |
| ⟨ ⟩ ⌈ ⌉ ⌊ ⌋ | brackets | 1 |
| ⟹ ⟺ ↦ ⊕ ⊗ | arrows and rings | 1 |

Superscripts and subscripts have their own code points: x² + y² = z²,
H₂O, CO₂, and aₙ₊₁ = aₙ + d.

## Box drawing and blocks

Every glyph here is exactly one cell, which is what makes ASCII diagrams
possible at all:

```
─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼        light
━ ┃ ┏ ┓ ┗ ┛ ┣ ┫ ┳ ┻ ╋        heavy
═ ║ ╔ ╗ ╚ ╝ ╠ ╣ ╦ ╩ ╬        double
╭ ╮ ╰ ╯                       rounded
░ ▒ ▓ █ ▁ ▂ ▃ ▄ ▅ ▆ ▇         shading and blocks
▏ ▎ ▍ ▌ ▋ ▊ ▉                 partial columns
◐ ◑ ◒ ◓ ⣾ ⣽ ⣻ ⢿ ⡿ ⣟ ⣯ ⣷      spinners
```

A sparkline built from block characters, which is the cheapest chart a terminal
can draw: ▁▂▃▄▅▆▇█▇▆▅▄▃▂▁▁▂▄▇█▇▄▂▁

## Wide and narrow together

The interesting failures happen at the boundary. These list items mix scripts
inside a single line, so a wrap has to land in a legal place regardless of what
is on either side of it:

- 短 — a two-cell item, and nothing else
- 项目二：这是一个比较长的条目，需要在正确的位置换行才不会溢出终端的右边缘
- Mixing 中文 and English in one sentence is completely normal writing, and
  the wrap point can fall on either side of the boundary
- `const 名前 = "識別子"` — CJK inside inline code, where the tinted background
  has to cover exactly the right number of cells
- 🚀 An item that starts with an emoji, so the hanging indent has to account
  for two cells before the first word even begins
- ⚠️ An item starting with a variation-selector sequence, which is the same
  problem plus one zero-width code point
- **粗体中文** and *斜体中文* and ~~删除线~~ — emphasis over wide characters
- A really quite long item written entirely in ASCII, included so that there is
  something to compare the wrapping of the wide-character items against

And the same mixture inside a table, where it also has to solve columns:

| Script | Sample | Cells | Chars | Ratio |
|:---|:---|---:|---:|---:|
| Latin | `folio` | 5 | 5 | 1.0 |
| Chinese | `折页` | 4 | 2 | 2.0 |
| Japanese | `折り本` | 6 | 3 | 2.0 |
| Korean | `접지본` | 6 | 3 | 2.0 |
| Emoji | `🚀🚀` | 4 | 4 | 1.0 |
| ZWJ | `👨‍👩‍👧‍👦` | 2 | 11 | 0.18 |
| Combining | `é` (decomposed) | 1 | 2 | 0.5 |
| Half-width kana | `ﾌｫﾘｵ` | 4 | 4 | 1.0 |

If every number in the "Cells" column matches what your terminal actually drew,
the measurement is right. If the table's vertical bars line up down the page,
the layout is right. Those are two different claims and this file checks both.

## Where to next

Back to the [index](README.md), or on to [Front matter](08-frontmatter.md).
