// Проверка геометрии переходов между экранами.
//
// Что проверяем и почему именно это: во время перехода два слоя обязаны
// закрывать экран целиком. Незакрытая полоса — не косметика, а чёрный
// прямоугольник: фон приложения в тёмной теме равен #000000, и всё, что не
// прикрыто экраном, выглядит дырой. Именно так и проявился баг — «если нажать
// назад, появляется чёрный экран».
//
// Причин было две, и обе здесь закрыты проверками:
//   1. направление перехода лежало в рефе, а изменение рефа не вызывает
//      перерисовку — первый кадр считался по геометрии ПРЕДЫДУЩЕГО направления,
//      то есть входящий экран ставился за правый край;
//   2. уходящий экран снимался только при честном завершении анимации, поэтому
//      прерванный переход оставлял его висеть поверх нового навсегда.
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
const DIRECTIONS = ["push", "pop", "modal"];

function at(range, p) {
  return range.from + (range.to - range.from) * p;
}

/** Закрыт ли каждый пиксель экрана хотя бы одним слоем при прогрессе p. */
function uncoveredAt(layout, p) {
  const spans = [
    [at(layout.enterX, p), at(layout.enterX, p) + W],
    [at(layout.leaveX, p), at(layout.leaveX, p) + W],
  ];
  // Идём по экрану мелким шагом: аналитическое объединение отрезков здесь
  // излишне, а шаг в пиксель ловит любую щель шире пикселя.
  for (let x = 0; x <= W; x += 1) {
    if (!spans.some(([a, b]) => x >= a && x <= b)) return x;
  }
  return null;
}

for (const dir of DIRECTIONS) {
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

// В конце перехода входящий экран обязан стоять ровно на месте, иначе после
// перехода часть экрана останется сдвинутой.
for (const dir of DIRECTIONS) {
  const layout = navLayout(dir, W, H);
  check(
    `${dir}: входящий доезжает до нуля`,
    layout.enterX.to === 0 && layout.enterY.to === 0,
    `x=${layout.enterX.to}, y=${layout.enterY.to}`,
  );
}

// Направление обязано быть различимым: если push и pop дают одну геометрию,
// «назад» визуально не отличается от «вперёд», а именно это и было сломано.
const push = navLayout("push", W, H);
const pop = navLayout("pop", W, H);
check("push и pop не совпадают", push.enterX.from !== pop.enterX.from, `${push.enterX.from} против ${pop.enterX.from}`);
check("при возврате уходящий сверху", pop.leavingOnTop === true);
check("при переходе вперёд сверху входящий", push.leavingOnTop === false);
check("модальный выезжает снизу и проявляется", navLayout("modal", W, H).enterY.from > 0 && navLayout("modal", W, H).enterFade);

// Входящий экран не должен начинать за пределами экрана при возврате: он всё
// время был под уходящим, и «выезд» ему не нужен.
check("при возврате входящий почти на месте", Math.abs(pop.enterX.from) <= W * 0.25, String(pop.enterX.from));

// Снятие уходящего экрана.
check("доигравший переход снимается", clearTransition({ id: 7 }, 7) === null);
const newer = { id: 9 };
check("поздний ответ прерванной анимации не снимает новый переход", clearTransition(newer, 8) === newer);
check("снятие на пустом состоянии безопасно", clearTransition(null, 3) === null);

// Прерванный переход обязан сниматься так же, как доигравший: раньше он
// оставался навсегда, и уходящий экран висел поверх нового.
check("прерванный переход тоже снимается", clearTransition({ id: 4 }, 4) === null);

const failed = results.filter((r) => !r.ok);
console.log(`\nИтог: ${results.length - failed.length}/${results.length} проверок пройдено`);
process.exit(failed.length === 0 ? 0 : 1);
