import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require_ = createRequire(import.meta.url);

/**
 * Настоящий список экспортов react-native-libsodium для нативных платформ.
 *
 * Список читается из самого модуля, а не пишется руками: рукописный список я
 * уже дважды составил неверно (не заметил отсутствия `crypto_box_beforenm`, а
 * потом `from_string`), и оба раза это ломало приложение на устройстве при
 * зелёных тестах в Node.
 *
 * Файл именно `lib.native.js`: Metro на Android и iOS выбирает вариант с
 * суффиксом `.native`, а `lib.js` — это web-версия, которая просто проксирует
 * libsodium-wrappers и потому содержит вообще всё.
 *
 * Модуль не импортируется, а разбирается как текст: его исполнение в Node
 * потянуло бы за собой react-native.
 */
export function readNativeSodiumExports(): Set<string> {
  const path = require_.resolve("react-native-libsodium/lib/commonjs/lib.native.js");
  const source = readFileSync(path, "utf-8");
  const names = new Set<string>();

  // exports.foo = foo;  и  exports.a = exports.b = void 0;
  for (const match of source.matchAll(/exports\.([A-Za-z0-9_$]+)\s*=/g)) names.add(match[1]!);
  // Object.defineProperty(exports, "foo", { ... })  — так реэкспортируются to_string и др.
  for (const match of source.matchAll(/defineProperty\(exports,\s*"([A-Za-z0-9_$]+)"/g)) {
    names.add(match[1]!);
  }

  names.delete("__esModule");
  return names;
}
