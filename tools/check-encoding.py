# Проверка кодировки исходников.

# Ловит три поломки, которые одинаково выглядят и одинаково плохо ищутся:
#   1. двойное кодирование кириллицы (UTF-8, прочитанный как CP1251)
#   2. битый UTF-8
#   3. пропавший файл
#
# Комментарии и текст в обратных кавычках пропускаются: симптом бывает
# описан прямо в исходниках, и проверка не должна на него ругаться.
#
# Запуск: python tools/check-encoding.py

import os
import re
import sys
import unicodedata

sys.stdout.reconfigure(encoding="utf-8")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = ["index.html", "styles.css", "content.js", "level.js", "game.js", "ui.js", "main.js"]
COMMENT = re.compile(r"//[^\n]*|/\*.*?\*/", re.S)
BACKTICKS = re.compile(r"`[^`]*`")

# Символы, которые встречаются в нормальном русском тексте и в кириллице.
CYRILLIC = re.compile(r"[А-Яа-яЁё]")


def strip_noise(text):
    text = COMMENT.sub(" ", text)
    return BACKTICKS.sub(" ", text)


def check_file(path):
    problems = []
    raw = open(path, "rb").read()
    if not raw:
        return ["пустой файл"]

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        return ["битый UTF-8: {}".format(exc)]

    clean = strip_noise(text)

    # двойное кодирование: кириллица не из своего диапазона
    mojibake = CYRILLIC.findall(clean)
    if not mojibake and any("Ð" <= ch <= "ÿ" for ch in clean):
        problems.append("похоже на двойное кодирование: нет ни одной русской буквы, "
                        "зато есть Ð/Ñ-подобные символы")

    # проверка на заменяющие символы
    if "�" in clean:
        problems.append("в тексте есть символ замены U+FFFD")

    # размер файла: после двойного кодирования он распухает примерно вдвое
    letters = len([ch for ch in clean if not ch.isspace()])
    if letters and len(raw) / letters > 4.5:
        problems.append("подозрительно много байт на символ ({} байт) — "
                        "похоже на перекодировку".format(round(len(raw) / letters, 1)))

    return problems


def main():
    failed = False
    for name in FILES:
        path = os.path.join(ROOT, name)
        if not os.path.exists(path):
            print("ПРОПАЛ  {}".format(name))
            failed = True
            continue
        problems = check_file(path)
        if problems:
            failed = True
            for p in problems:
                print("ПЛОХО  {} — {}".format(name, p))
        else:
            print("ок     {}".format(name))

    if failed:
        print("\nЧто-то не так. Открой файлы в редакторе и сохрани как UTF-8 — "
              "не перенаправлением в консоли.")
        return 1
    print("\nВсе файлы в порядке.")
    return 0


if __name__ == "__main__":
    sys.exit(main())