// Проверка геометрии переходов между экранами.
//
// Что проверяем и почему именно это: во время push/pop-перехода два слоя
// обязаны закрывать экран целиком. Незакрытая полоса — не косметика, а чёрный
// прямоугольник: фон приложения в тёмной теме равен #000000, и всё, что не
// прикрыто экраном, выглядит дырой. Именно так и проявился первый баг —
// «если нажать назад, появляется чёрный экран».
//
// Второй баг был другого рода: закрытие модального экрана (контакты) ехало как
// обычное «назад» (вбок), хотя открывалось снизу — движение при выходе не
// совпадало с тем, как экран появился. Здесь это проверяется как явное условие
// симметрии: modalClose обязан быть зеркалом modalOpen.
//
// Запуск: npm run check:nav
import { navLayout, clearTransition } from "../src/ui/navigatorLayout.ts";

const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

const W = 400;
const H = 900;
const HORIZONTAL = ["push", "pop"];
const ALL = ["push", "pop", "modalOpen", "modalClose"];

function at(range, p) {
  return range.from + (range.to - range.from) * p;
}

/** Первый непокрытый слоями пиксель по X при прогрессе p (или null, если всё закрыто). */
function uncoveredAt(layout, p) {
  const spans = [
    [at(layout.enterX, p), at(layout.enterX, p) + W],
    [at(layout.leaveX, p), at(layout.leaveX, p) + W],
  ];
  for (let x = 0; x <= W; x += 1) {
    if (!spans.some(([a, b]) => x >= a && x <= b)) return x;
  }
  return null;
}

// ── Чёрный экран: push/pop обязаны закрывать экран на всём протяжении ──────
for (const dir of HORIZONTAL) {
  const layout = navLayout(dir, W, H);
  let worst = null;
  for (let step = 0; step <= 40; step += 1) {
    const p = step / 40;
    const gap = uncoveredAt(layout, p);
    if (gap !== null) {
      worst = { p, gap };
      break;
    }
  }
  check(
    `${dir}: экран закрыт на всём переходе`,
    worst === null,
    worst === null ? "" : `дыра на x=${worst.gap} при прогрессе ${worst.p.toFixed(2)}`,
  );
}

// ── Входящий обязан доехать до нуля — иначе после перехода экран сдвинут ───
for (const dir of ALL) {
  const layout = navLayout(dir, W, H);
  check(
    `${dir}: входящий доезжает до нуля`,
    layout.enterX.to === 0 && layout.enterY.to === 0,
    `x=${layout.enterX.to}, y=${layout.enterY.to}`,
  );
}

// ── Направления обязаны быть различимы ──────────────────────────────────────
const push = navLayout("push", W, H);
const pop = navLayout("pop", W, H);
check("push и pop не совпадают", push.enterX.from !== pop.enterX.from, `${push.enterX.from} против ${pop.enterX.from}`);
check("при возврате уходящий сверху", pop.leavingOnTop === true);
check("при переходе вперёд сверху входящий", push.leavingOnTop === false);
check("при возврате входящий почти на месте", Math.abs(pop.enterX.from) <= W * 0.25, String(pop.enterX.from));

// ── Модальное: открытие снизу, закрытие — точное зеркало ───────────────────
const open = navLayout("modalOpen", W, H);
const close = navLayout("modalClose", W, H);

check("modalOpen выезжает снизу и проявляется", open.enterY.from > 0 && open.enterOpacity.from === 0);
check("modalOpen: нижний слой темнеет и уменьшается", open.leaveOpacity.to < 1 && open.leaveScale.to < 1);
check("modalOpen: верхний слой (входящий) на переходе сверху", open.leavingOnTop === false);

// Модальный по построению не может дать чёрный экран: тот из двух слоёв, что
// сейчас изображает «нижний, лежащий контент» (при открытии — leave, при
// закрытии — enter, потому что закрывающийся сам уезжает), никогда не
// двигается ни по X, ни по Y и всегда покрывает всё целиком.
const stillStatic = (range) => range.from === 0 && range.to === 0;
check("modalOpen: нижний (уходящий) слой не двигается", stillStatic(open.leaveX) && stillStatic(open.leaveY));
check(
  "modalClose: нижний (входящий, он же revealed) слой не двигается",
  stillStatic(close.enterX) && stillStatic(close.enterY),
);

// Симметрия — сердце этой проверки. Раньше закрытие шло направлением "pop", то
// есть этих равенств не было вовсе: modalClose был геометрией push/pop, а не
// зеркалом modalOpen.
check(
  "modalClose: уходящий доигрывает вход modalOpen в обратную сторону (Y)",
  close.leaveY.from === open.enterY.to && close.leaveY.to === open.enterY.from,
  `${JSON.stringify(close.leaveY)} против разворота ${JSON.stringify(open.enterY)}`,
);
check(
  "modalClose: уходящий доигрывает вход modalOpen в обратную сторону (opacity)",
  close.leaveOpacity.from === open.enterOpacity.to && close.leaveOpacity.to === open.enterOpacity.from,
);
check(
  "modalClose: входящий доигрывает выход modalOpen в обратную сторону (opacity)",
  close.enterOpacity.from === open.leaveOpacity.to && close.enterOpacity.to === open.leaveOpacity.from,
);
check(
  "modalClose: входящий доигрывает выход modalOpen в обратную сторону (scale)",
  close.enterScale.from === open.leaveScale.to && close.enterScale.to === open.leaveScale.from,
);
check("modalClose: уходящий (закрывающийся) поверх", close.leavingOnTop === true);
check(
  "modalClose и modalOpen не двигают по X ни один слой",
  [open, close].every((l) => l.enterX.from === 0 && l.enterX.to === 0 && l.leaveX.from === 0 && l.leaveX.to === 0),
);

// ── Тень-полоска только там, где слои реально едут по горизонтали ──────────
check("push/pop показывают тень у края", HORIZONTAL.every((d) => navLayout(d, W, H).hasEdgeScrim));
check(
  "модальные обходятся без горизонтальной тени",
  !open.hasEdgeScrim && !close.hasEdgeScrim,
);

// ── Снятие уходящего экрана ──────────────────────────────────────────────
check("доигравший переход снимается", clearTransition({ id: 7 }, 7) === null);
const newer = { id: 9 };
check("поздний ответ прерванной анимации не снимает новый переход", clearTransition(newer, 8) === newer);
check("снятие на пустом состоянии безопасно", clearTransition(null, 3) === null);
check("прерванный переход тоже снимается", clearTransition({ id: 4 }, 4) === null);

const failed = results.filter((r) => !r.ok);
console.log(`\nИтог: ${results.length - failed.length}/${results.length} проверок пройдено`);
process.exit(failed.length === 0 ? 0 : 1);
