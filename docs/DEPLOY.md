# DEPLOY.md — разворачивание сервера на VPS

Расчёт на то, что ты работаешь с Windows-ПК и раньше с VPS не имел дела. Всё
проверяется командами по шагам.

## 0. Что нужно перед началом

- Арендованный VPS. Рекомендация: **Hetzner Cloud CX22** (2 vCPU / 4 GB RAM / 40 GB,
  ~4-6 €/мес, Германия) либо **Timeweb Cloud** аналогичной конфигурации, если
  нужен физически российский дата-центр. ОС при заказе — **Ubuntu 22.04 LTS**.
- Домен (см. ARCHITECTURE.md §0) **или** бесплатный поддоменом на
  [duckdns.org](https://www.duckdns.org) для старта — Let's Encrypt его тоже примет.
- С Windows: подключаться по SSH можно прямо из PowerShell (`ssh` идёт в комплекте
  Windows 10/11), отдельный PuTTY не нужен.

## 1. Первое подключение и базовая защита VPS

Провайдер после создания VPS присылает IP и root-пароль (или сразу просит
залить SSH-ключ — это безопаснее пароля, если провайдер предлагает при
создании VPS вставить публичный ключ, вставь `~/.ssh/id_ed25519.pub` со своего
ПК; если такого ключа ещё нет — `ssh-keygen -t ed25519` в PowerShell).

```powershell
ssh root@<IP_ВЫДАННЫЙ_ПРОВАЙДЕРОМ>
```

На сервере:

```bash
apt update && apt upgrade -y

# отдельный пользователь вместо постоянной работы под root
adduser deploy
usermod -aG sudo deploy

# базовый firewall: снаружи открыты только SSH, HTTP (только для ACME-проверки
# Let's Encrypt) и HTTPS (реальный трафик мессенджера)
apt install -y ufw
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

Дальше заходи уже под `deploy`, не под `root`:

```powershell
ssh deploy@<IP>
```

## 2. Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# перезайти по SSH, чтобы группа docker подхватилась
exit
```

```powershell
ssh deploy@<IP>
```

```bash
docker --version
docker compose version
```

## 3. DNS

В панели регистратора домена (или в duckdns.org) создай **A-запись**,
указывающую на IP VPS:

```
chat.example.com.  A  <IP_VPS>
```

Проверить с ПК (Windows PowerShell), что DNS уже разошёлся (может занять от
минут до пары часов):

```powershell
nslookup chat.example.com
```

Пока не увидишь в ответе IP своего VPS — дальше можно не идти, Caddy не
получит сертификат без правильного DNS.

## 4. Код на сервер

Самый простой путь — клонировать репозиторий прямо на VPS:

```bash
sudo apt install -y git
git clone <URL_ТВОЕГО_РЕПОЗИТОРИЯ> family-messenger
cd family-messenger
```

## 5. Настройка `.env`

```bash
cp .env.example .env
nano .env
```

Заполни:

```
DOMAIN=chat.example.com
ACME_EMAIL=твоя-почта@example.com
```

Остальные переменные (`MESSAGE_TTL_DAYS`, `DEFAULT_INVITE_TTL_HOURS`,
`LOG_LEVEL`) можно оставить по умолчанию. `Ctrl+O`, `Enter`, `Ctrl+X` — сохранить
и выйти из `nano`.

## 6. Запуск одной командой

```bash
docker compose up -d --build
```

Первый запуск соберёт образ сервера (несколько минут) и поднимет Caddy,
который автоматически запросит сертификат Let's Encrypt для `DOMAIN`.

Если сборка упала с `429 Too Many Requests` от `registry-1.docker.io` — это
лимит анонимных скачиваний Docker Hub для IP твоего VPS (часто «съедается»
соседями по облаку), а не проблема кода. Собери через зеркало Google, оно
без лимита и не требует регистрации:

```bash
NODE_IMAGE=mirror.gcr.io/library/node:20-bookworm \
NODE_SLIM_IMAGE=mirror.gcr.io/library/node:20-bookworm-slim \
docker compose up -d --build
```

Чтобы не набирать это каждый раз, те же две строки можно добавить в `.env`.

Проверка:

```bash
docker compose ps
docker compose logs -f caddy     # ищи строки "certificate obtained successfully"
docker compose logs -f server    # сервер должен залогировать применённые миграции и старт на 0.0.0.0:8080
```

Снаружи (с любого компьютера):

```powershell
curl https://chat.example.com/healthz
```

Ожидаемый ответ: `{"status":"ok","connectedDevices":0}`.

Если `curl` вернёт ошибку сертификата — подожди 1-2 минуты и попробуй снова
(Let's Encrypt иногда выдаёт не с первой попытки, Caddy сам ретраит) и ещё раз
проверь `docker compose logs caddy` на ошибки ACME (частая причина — DNS ещё
не разошёлся или порт 80 закрыт файрволом хостера, не только `ufw` на самой
машине — проверь в панели провайдера, что порты 80/443 не блокируются
отдельно).

## 7. Первый инвайт (ты — админ)

```bash
docker compose exec server npm run invite:create
```

Скрипт выведет 8-символьный код, QR в консоли и срок действия (по умолчанию
24 часа). Этот код/QR ты передаёшь первому участнику семьи, которого
регистрируешь (в MVP клиент появится в Этапе 3 — пока протокол проверяется
через `wscat` или другой тестовый WS-клиент, инструкция в разделе ниже).

## 8. Проверка вручную (без клиента, который появится в Этапе 3)

С своего ПК (Node.js должен быть установлен):

```powershell
npm install -g wscat
wscat -c wss://chat.example.com/ws
```

Сервер сразу пришлёт `auth.challenge`. Полноценно "отвечать" на него руками
неудобно (нужна подпись Ed25519) — для ручной проверки протокола на этом
этапе достаточно убедиться, что `auth.challenge` пришёл и соединение держится
(значит TLS/Caddy/Fastify/ws работают). Полный сценарий "получить инвайт →
сгенерировать ключи → зарегистрироваться → аутентифицироваться" будет
проверяться автоматически в Этапе 2-3 (юнит- и интеграционные тесты
крипто-пакета и клиента).

## 9. Обновление сервера после изменений в коде

```bash
cd family-messenger
git pull
docker compose up -d --build
```

Данные (`./data/server.db`) не затрагиваются — volume отдельно от образа.

## 10. Бэкап (кратко; подробно — docs/OPERATIONS.md в Этапе 7)

```bash
cp data/server.db data/server.db.bak-$(date +%Y%m%d)
```

## Если EAS/Expo вообще недоступен и нужен локальный билд APK

Это не относится к серверу — см. `docs/BUILD.md` (появится в Этапе 6), там
описаны оба пути: `eas build` и локальный `gradlew assembleRelease`.
