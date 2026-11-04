#!/usr/bin/env python3
"""Potok Video — pomocnik (native messaging host) dla wtyczki w Brave/Chrome (macOS + Windows).

Brave uruchamia ten skrypt na chwilę, gdy wtyczka czegoś potrzebuje:
  probe    -> lista dostępnych jakości (yt-dlp -J)
  download -> start pobierania w tle (osobny proces, powiadomienie po zakończeniu)
  open     -> otwiera folder z pobranymi plikami
"""
import csv
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import threading
import time

WIN = sys.platform == "win32"

if WIN:
    # PATH z rejestru — żeby świeżo zainstalowane narzędzia działały bez restartu przeglądarki
    import winreg
    parts = [os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\WinGet\Links")]
    for root, key in ((winreg.HKEY_CURRENT_USER, "Environment"),
                      (winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")):
        try:
            with winreg.OpenKey(root, key) as k:
                parts.append(os.path.expandvars(winreg.QueryValueEx(k, "Path")[0]))
        except OSError:
            pass
    parts.append(os.environ.get("PATH", ""))
    os.environ["PATH"] = ";".join(parts)
    APP_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "PotokVideo")
    NO_WINDOW = subprocess.CREATE_NO_WINDOW
else:
    os.environ["PATH"] = ":".join([
        "/opt/homebrew/bin", "/usr/local/bin", os.path.expanduser("~/.local/bin"),
        os.path.expanduser("~/.deno/bin"), os.environ.get("PATH", "/usr/bin:/bin"),
    ])
    APP_DIR = os.path.expanduser("~/Library/Application Support/PotokVideo")
    NO_WINDOW = 0

OUT_DIR = os.path.join(os.path.expanduser("~"), "Downloads", *([] if WIN else ["Potok Video"]))
LOG_DIR = os.path.join(APP_DIR, "logs")
TXT = {"text": True, "encoding": "utf-8", "errors": "replace", "creationflags": NO_WINDOW}
SORT = "res,fps,vcodec:h264,acodec:aac"  # h264 = bez problemów w DaVinci / QuickTime


# ---------- native messaging ----------
def read_msg():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    n = struct.unpack("<I", raw)[0]
    return json.loads(sys.stdin.buffer.read(n).decode("utf-8"))


def send(obj):
    data = json.dumps(obj).encode("utf-8")
    sys.stdout.buffer.write(struct.pack("<I", len(data)) + data)
    sys.stdout.buffer.flush()


# ---------- yt-dlp ----------
def ytdlp():
    path = shutil.which("yt-dlp")
    if not path:
        raise RuntimeError("Nie znaleziono yt-dlp. Uruchom ponownie instalator.")
    return path


def cookie_file(m):
    """Ciasteczka z przeglądarki -> plik Netscape dla yt-dlp (np. TikTok bez nich daje 403)."""
    cookies = m.get("cookies") or []
    if not cookies:
        return None
    tmp_dir = os.path.join(APP_DIR, "tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    path = os.path.join(tmp_dir, f"cookies-{os.getpid()}-{os.urandom(3).hex()}.txt")
    soon = int(time.time()) + 86400
    lines = ["# Netscape HTTP Cookie File"]
    for c in cookies:
        dom = c.get("domain", "")
        if not dom or not c.get("name"):
            continue
        host_only = c.get("hostOnly", False)
        dom = dom.lstrip(".") if host_only else ("." + dom.lstrip("."))
        exp = int(c.get("expirationDate") or soon)
        val = str(c.get("value", "")).replace("\t", " ").replace("\n", " ")
        lines.append("\t".join([dom, "FALSE" if host_only else "TRUE", c.get("path") or "/",
                                 "TRUE" if c.get("secure") else "FALSE", str(exp), c["name"], val]))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    return path


def drop(path):
    if path:
        try:
            os.remove(path)
        except OSError:
            pass


def nice_error(stderr, fallback):
    lines = [l.strip() for l in (stderr or "").splitlines() if l.strip()]
    if not lines:
        return fallback
    last = lines[-1]
    joined = " ".join(lines).lower()
    if "drm" in joined:
        return "Ten film jest zabezpieczony DRM (np. Netflix, część płatnych platform) — nie da się go pobrać."
    if any(k in joined for k in ("sign in", "log in", "login required", "logged-in", "private video",
                                 "authentication", "--cookies")):
        return "Wymaga zalogowania — zaloguj się na tej stronie w przeglądarce, odśwież ją i spróbuj ponownie."
    if "unsupported url" in joined:
        return "Ta strona nie jest obsługiwana bezpośrednio — odpal film, żeby wtyczka złapała plik."
    if "403" in last:
        return "Serwer odmówił dostępu (403). Odśwież stronę, odpal film jeszcze raz i spróbuj ponownie."
    if "404" in last or "410" in last:
        return "Link do filmu wygasł. Odśwież stronę i spróbuj ponownie."
    import re
    if "wyciąć fragmentu" in last:
        return last.replace("ERROR: ", "")
    last = re.sub(r"https?://\S+", "[link]", last)
    last = re.sub(r"^ERROR:\s*(\[[^\]]+\]\s*)?[^:]{0,80}?:\s*", "", last)
    return last[:200]


def base_args(m):
    args = ["--no-playlist", "--no-warnings"] + (["--encoding", "utf-8"] if WIN else [])
    if m.get("_cookiefile"):
        args += ["--cookies", m["_cookiefile"]]
    if m.get("imp"):
        args += ["--impersonate", "chrome"]
    if m.get("referer"):
        args += ["--referer", m["referer"]]
    if m.get("ua"):
        args += ["--user-agent", m["ua"]]
    return args


def fsize(f):
    return f.get("filesize") or f.get("filesize_approx") or 0


def est(f, info):
    """Szacunek rozmiaru z bitrate'u, gdy serwis nie podaje rozmiaru pliku."""
    tbr, dur = f.get("tbr"), info.get("duration")
    return int(tbr * 125 * dur) if tbr and dur else 0


def probe(m):
    m["_cookiefile"] = cookie_file(m)
    run = lambda: subprocess.run([ytdlp(), "-J", *base_args(m), m["url"]], capture_output=True, timeout=90, **TXT)
    try:
        r = run()
        # blokada typu Cloudflare/403 -> druga próba z „udawaniem” prawdziwego Chrome
        if r.returncode != 0 and any(k in r.stderr for k in ("403", "Cloudflare", "cloudflare", "429")):
            m["imp"] = True
            r2 = run()
            if r2.returncode == 0:
                r = r2
            else:
                m["imp"] = False
    finally:
        drop(m.pop("_cookiefile", None))
    if r.returncode != 0:
        raise RuntimeError(nice_error(r.stderr, "Nie udało się odczytać tej strony"))
    info = json.loads(r.stdout)
    if info.get("_type") == "playlist" and info.get("entries"):
        info = next((e for e in info["entries"] if e), info)

    formats = info.get("formats") or []
    videos = [f for f in formats if f.get("vcodec") != "none" and f.get("height")]
    audios = [f for f in formats if f.get("vcodec") == "none" and f.get("acodec") not in (None, "none")]
    best_audio = max(audios, key=lambda f: (f.get("ext") == "m4a", f.get("abr") or 0), default=None)

    options = []
    for h in sorted({f["height"] for f in videos}, reverse=True):
        cands = [f for f in videos if f["height"] == h]
        pick = max(cands, key=lambda f: (str(f.get("vcodec", "")).startswith("avc"), f.get("tbr") or 0))
        size = fsize(pick) or est(pick, info)
        if size and pick.get("acodec") in (None, "none") and best_audio:
            size += fsize(best_audio) or est(best_audio, info)
        options.append({
            "label": f"{h}p",
            "fmt": f"bv*[height<={h}]+ba/b[height<={h}]",
            "size": size,
        })

    if not options:  # brak informacji o rozdzielczości — jedna opcja „najlepsza”
        options.append({"label": "Najlepsza", "fmt": "bv*+ba/b", "size": fsize(info)})
    if audios:
        options.append({"label": "Tylko audio", "fmt": "ba[ext=m4a]/ba", "audio": True,
                        "size": fsize(best_audio) if best_audio else 0})

    return {
        "ok": True,
        "subs": pick_subs(info),
        "title": info.get("title"),
        "uploader": info.get("uploader") or info.get("channel"),
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "imp": bool(m.get("imp")),
        "options": options,
    }


def pick_subs(info):
    """Wybiera 1–2 sensowne języki napisów: ręczne PL/EN/oryginał, inaczej automatyczne w oryginale."""
    manual = {k: v for k, v in (info.get("subtitles") or {}).items() if k != "live_chat"}
    auto = info.get("automatic_captions") or {}
    lang = (info.get("language") or "").split("-")[0]
    picks = [k for k in manual if k.split("-")[0] in ("pl", "en", lang)]
    if not picks and manual:
        picks = [next(iter(manual))]
    if not picks:
        picks = [k for k in auto if k.endswith("-orig")][:1] or [k for k in ("pl", "en") if k in auto][:1]
    return picks[:2]


def out_dir(m):
    d = ((m.get("settings") or {}).get("outDir") or "").strip()
    d = os.path.expanduser(d) if d else OUT_DIR
    try:
        os.makedirs(d, exist_ok=True)
        return d
    except OSError:
        os.makedirs(OUT_DIR, exist_ok=True)
        return OUT_DIR


def notify(title, text):
    try:
        if WIN:
            ps = (
                "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;"
                "$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);"
                "$t = $x.GetElementsByTagName('text');"
                "$t.Item(0).AppendChild($x.CreateTextNode($env:PV_T)) | Out-Null;"
                "$t.Item(1).AppendChild($x.CreateTextNode($env:PV_B)) | Out-Null;"
                "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("
                "'{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe')"
                ".Show([Windows.UI.Notifications.ToastNotification]::new($x))"
            )
            env = dict(os.environ, PV_T="Potok Video — " + title, PV_B=text)
            subprocess.run(["powershell", "-NoProfile", "-Command", ps], env=env,
                           capture_output=True, creationflags=NO_WINDOW, timeout=15)
        elif shutil.which("osascript"):
            subprocess.run([
                "osascript", "-e", "on run argv",
                "-e", 'display notification (item 2 of argv) with title "Potok Video" subtitle (item 1 of argv)',
                "-e", "end run", title, text,
            ], capture_output=True)
    except Exception:  # noqa: BLE001 — powiadomienie to dodatek
        pass


JOB_DIR = os.path.join(APP_DIR, "jobs")


def write_job(job):
    tmp = os.path.join(JOB_DIR, f'{job["id"]}.{threading.get_ident()}.tmp')
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(job, fh)
    os.replace(tmp, os.path.join(JOB_DIR, job["id"] + ".json"))


def run_quiet(cmd, timeout=None):
    return subprocess.run(cmd, capture_output=True, timeout=timeout, **TXT)


def probe_media(path):
    if not shutil.which("ffprobe"):
        return {}
    r = run_quiet(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=width,height,codec_type",
                   "-of", "json", path], timeout=60)
    try:
        j = json.loads(r.stdout)
    except Exception:  # noqa: BLE001
        return {}
    v = next((x for x in j.get("streams", []) if x.get("codec_type") == "video"), {})
    return {"duration": float(j.get("format", {}).get("duration") or 0),
            "width": v.get("width") or 0, "height": v.get("height") or 0}


def make_storyboard(path, info):
    """Jeden obrazek z klatkami co kilka sekund (max 36) + znacznik czasu na każdej."""
    dur = info.get("duration") or 0
    if not dur or not info.get("height") or not shutil.which("ffmpeg"):
        return None
    interval = max(1.0, dur / 36)
    n = max(1, math.ceil(dur / interval))
    cols = min(6, n)
    rows = math.ceil(n / cols)
    tw = 200 if info["height"] > info["width"] else 320
    out = os.path.splitext(path)[0] + " - storyboard.jpg"
    font = next((f for f in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/Library/Fonts/Arial.ttf",
                             r"C:\Windows\Fonts\arial.ttf") if os.path.exists(f)), None)
    tile = f"tile={cols}x{rows}:padding=4:margin=4:color=0x111111"
    base = f"fps=1/{interval:.3f},scale={tw}:-2"
    variants = []
    if font:
        ff = font.replace("\\", "/").replace(":", r"\:")
        txt = (f"drawtext=fontfile='{ff}':text='%{{pts\\:hms}}':x=6:y=h-th-6:fontsize=13:"
               "fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=3")
        variants.append(f"{base},{txt},{tile}")
    variants.append(f"{base},{tile}")
    pre = ["-skip_frame", "nokey"] if dur > 300 else []
    for vf in variants:
        r = run_quiet(["ffmpeg", "-y", "-v", "error", *pre, "-i", path, "-vf", vf, "-frames:v", "1",
                       "-q:v", "3", out], timeout=600)
        if r.returncode == 0 and os.path.exists(out):
            return out
    return None


def strip_metadata(path):
    ext = os.path.splitext(path)[1].lower()
    if shutil.which("ffmpeg") and ext in (".mp4", ".m4v", ".mov", ".m4a", ".webm", ".mkv", ".mp3"):
        tmp = os.path.splitext(path)[0] + ".clean" + ext
        cmd = ["ffmpeg", "-y", "-v", "error", "-i", path, "-map", "0:v?", "-map", "0:a?", "-dn",
               "-map_metadata", "-1", "-map_chapters", "-1", "-c", "copy",
               "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact"]
        if ext in (".mp4", ".m4v", ".mov", ".m4a"):
            cmd += ["-movflags", "+faststart"]
        r = run_quiet(cmd + [tmp], timeout=900)
        if r.returncode == 0 and os.path.exists(tmp):
            os.replace(tmp, path)
        elif os.path.exists(tmp):
            os.remove(tmp)
    if not WIN and shutil.which("xattr"):
        run_quiet(["xattr", "-c", path])  # m.in. „pobrano z” (adres źródłowy) w Finderze


SWIPE_COLS = ["Data pobrania", "Platforma", "Autor", "Tytuł", "Link", "Wyświetlenia", "Polubienia",
              "Data publikacji", "Długość", "Jakość", "ID reklamy", "Start reklamy", "Dni aktywności", "Plik"]


def ad_days(meta, m):
    start = meta.get("adStart") or ""
    if not (m.get("settings") or {}).get("adDays", True) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start):
        return ""
    import datetime
    try:
        return (datetime.date.today() - datetime.date.fromisoformat(start)).days + 1
    except ValueError:
        return ""


def csv_target(folder):
    """swipe-file.csv; stary plik z innymi kolumnami odkładamy na bok, żeby kolumny się nie rozjechały."""
    path = os.path.join(folder, "swipe-file.csv")
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8-sig") as fh:
                header = next(csv.reader(fh), [])
            if header != SWIPE_COLS:
                os.replace(path, os.path.join(folder, f"swipe-file (stary {time.strftime('%Y%m%d')}).csv"))
        except OSError:
            pass
    return path


def swipe_row(path, meta, info, m):
    folder = os.path.dirname(path)
    csv_path = csv_target(folder)
    up = str(meta.get("upload_date") or "")
    if re.fullmatch(r"\d{8}", up):
        up = f"{up[:4]}-{up[4:6]}-{up[6:]}"
    dur = meta.get("duration") or info.get("duration") or 0
    height = meta.get("height") or info.get("height")
    row = [time.strftime("%Y-%m-%d %H:%M"),
           meta.get("platform") or meta.get("extractor_key") or "",
           meta.get("author") or meta.get("uploader") or meta.get("channel") or "",
           meta.get("title") or m.get("display") or "",
           meta.get("link") or meta.get("webpage_url") or m.get("referer") or m.get("url") or "",
           meta.get("view_count") or "", meta.get("like_count") or "", up,
           f"{int(dur) // 60}:{int(dur) % 60:02d}" if dur else "",
           f"{height}p" if height else (m.get("label") or ""),
           meta.get("adId") or "", meta.get("adStart") or "", ad_days(meta, m), os.path.basename(path)]
    for target in (csv_path, os.path.join(folder, f"swipe-file-{time.strftime('%Y%m%d-%H%M%S')}.csv")):
        try:
            new = not os.path.exists(target)
            with open(target, "a", newline="", encoding="utf-8-sig" if new else "utf-8") as fh:
                w = csv.writer(fh)
                if new:
                    w.writerow(SWIPE_COLS)
                w.writerow(row)
            return
        except PermissionError:  # np. plik otwarty w Excelu
            continue


def fetch_subs(m, out_template):
    langs = m.get("subs") or []
    if not langs:
        return []
    cmd = [ytdlp(), *base_args(m), "--skip-download", "--write-subs", "--write-auto-subs",
           "--sub-langs", ",".join(langs), "--convert-subs", "srt",
           "--print", "after_video:SUBS|%(requested_subtitles)j", "-o", out_template, m["url"]]
    r = run_quiet(cmd, timeout=300)
    return [l for l in (r.stdout or "").splitlines() if l.startswith("SUBS|")]


def postprocess(path, m, meta, job=None):
    st = m.get("settings") or {}
    audio = m.get("audio") or os.path.splitext(path)[1].lower() in (".m4a", ".mp3", ".opus", ".aac")

    def stage(text):
        if job:
            job.update(status="post", stage=text, updated=time.time())
            write_job(job)

    info = probe_media(path)
    if st.get("stripMeta"):
        stage("Czyszczę metadane…")
        strip_metadata(path)
    if st.get("subs", True) and m.get("subs") and not m.get("subsOnly"):
        stage("Pobieram napisy…")
        fetch_subs(m, os.path.splitext(path)[0].replace("%", "%%") + ".%(ext)s")
    if st.get("storyboard", True) and not audio:
        stage("Tworzę storyboard…")
        make_storyboard(path, info)
    if st.get("swipe", True):
        swipe_row(path, meta, info, m)


ALIVE = 90  # s bez sygnału życia = proces padł, nie blokuje kolejki


def wait_turn(job):
    """Pobieramy po jednym: czekamy, aż skończą się wszystkie wcześniejsze (żywe) zadania."""
    while True:
        ahead = 0
        for fn in os.listdir(JOB_DIR):
            if not fn.endswith(".json") or fn[:-5] == job["id"]:
                continue
            try:
                with open(os.path.join(JOB_DIR, fn), encoding="utf-8") as fh:
                    j = json.load(fh)
            except Exception:  # noqa: BLE001
                continue
            if j.get("status") in ("done", "error") or time.time() - j.get("updated", 0) > ALIVE:
                continue
            if j.get("id", "") < job["id"]:
                ahead += 1
        if not ahead:
            return
        if job.get("ahead") != ahead:
            job["ahead"] = ahead
            write_job(job)
        time.sleep(1)


def heartbeat(job, stop):
    while not stop.wait(10):
        job["updated"] = time.time()
        try:
            write_job(job)
        except OSError:
            pass


def worker(m):
    """Uruchamiane w osobnym procesie — właściwe pobieranie + zapis postępu + obróbka."""
    os.makedirs(LOG_DIR, exist_ok=True)
    meta_in = m.get("meta") or {}

    if m.get("post"):  # plik pobrany przez przeglądarkę — tylko obróbka
        try:
            postprocess(m["post"], m, meta_in)
        except Exception as e:  # noqa: BLE001
            with open(os.path.join(LOG_DIR, "post-errors.log"), "a", encoding="utf-8") as fh:
                fh.write(f"{time.ctime()} {m['post']}: {e}\n")
        return

    folder = out_dir(m)
    if m.get("title"):
        name = m["title"].replace("%", "%%")
    else:  # „Kanał - Tytuł”
        name = "%(uploader,channel&{} - |)s%(title).90B"
    sec = m.get("section")
    suffix = "" if m.get("audio") or m.get("subsOnly") else "%(height& [{}p]|)s"
    if sec:
        suffix += " [" + sec.replace(":", ".") + "]"
    tmpl = os.path.join(folder, f"{name}{suffix}.%(ext)s")

    job = {"id": m["job"], "title": m.get("display") or m.get("title") or "Wideo",
           "label": m.get("label", ""), "thumb": m.get("thumb"), "status": "queued", "stage": "",
           "pct": 0, "part": 1, "speed": 0, "eta": None, "file": None, "error": None,
           "started": time.time(), "updated": time.time()}
    write_job(job)
    stop = threading.Event()
    threading.Thread(target=heartbeat, args=(job, stop), daemon=True).start()
    try:
        wait_turn(job)
        job.update(status="start", ahead=0)
        write_job(job)
        run_job(m, job, tmpl, sec, meta_in)
    finally:
        stop.set()


def run_job(m, job, tmpl, sec, meta_in):
    m["_cookiefile"] = cookie_file(m)

    if m.get("subsOnly"):
        lines = fetch_subs(m, tmpl)
        drop(m.get("_cookiefile"))
        files = []
        for l in lines:
            try:
                for v in (json.loads(l[5:]) or {}).values():
                    if v and v.get("filepath"):
                        files.append(os.path.splitext(v["filepath"])[0] + ".srt")
            except Exception:  # noqa: BLE001
                pass
        files = [f for f in files if os.path.exists(f)]
        job["updated"] = time.time()
        if files:
            job.update(status="done", pct=100, file=files[0])
            notify("Napisy pobrane ✓", os.path.basename(files[0]))
        else:
            job.update(status="error", error="Nie udało się pobrać napisów")
        write_job(job)
        return

    cmd = [ytdlp(), *base_args(m), "-f", m["fmt"], "-S", SORT, "-o", tmpl,
           "--no-mtime", "--newline", "--progress",
           "--progress-template", "download:PV|%(progress.status)s|%(progress.downloaded_bytes)s|"
           "%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s",
           "--print", "after_move:FILE|%(filepath)s",
           "--print", "after_move:META|%(.{title,uploader,channel,view_count,like_count,upload_date,"
           "duration,webpage_url,extractor_key,height})j",
           "--no-simulate"]
    if sec:
        cmd += ["--download-sections", "*" + sec]
    if not m.get("audio"):
        cmd += ["--merge-output-format", "mp4"]
    cmd.append(m["url"])

    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=1, **TXT)
    out_lines, last_write, prev_pct, meta = [], 0, 0, {}
    num = lambda v: float(v) if v not in (None, "", "NA", "None") else 0
    for line in p.stdout:
        line = line.strip()
        out_lines.append(line)
        if line.startswith("PV|"):
            _, st, done, total, est_total, speed, eta = (line.split("|") + [""] * 7)[:7]
            total = num(total) or num(est_total)
            pct = round(num(done) / total * 100, 1) if total else 0
            if pct + 20 < prev_pct:  # zaczęła się druga część (np. audio po wideo)
                job["part"] += 1
            prev_pct = pct
            job.update(status="download", pct=pct, speed=num(speed), eta=num(eta) or None)
            if time.time() - last_write > 0.4 or st == "finished":
                job["updated"] = time.time()
                write_job(job)
                last_write = time.time()
            if st == "finished":
                job.update(status="merge")
                write_job(job)
        elif line.startswith("FILE|"):
            job["file"] = line[5:]
        elif line.startswith("META|"):
            try:
                meta = json.loads(line[5:])
            except Exception:  # noqa: BLE001
                meta = {}
    err = p.stderr.read()
    p.wait()

    if p.returncode == 0 and sec and job["file"] and not probe_media(job["file"]).get("duration"):
        p.returncode = 1  # fragment się nie wyciął (serwer nie pozwala przewijać)
        err += "\nERROR: Nie udało się wyciąć fragmentu z tego źródła — pobierz cały film."
        drop(job["file"])
    if p.returncode == 0 and job["file"] and os.path.exists(job["file"]):
        meta.update({k: v for k, v in meta_in.items() if v})
        try:
            postprocess(job["file"], m, meta, job)
        except Exception as e:  # noqa: BLE001
            err += f"\n[postprocess] {e}"
    drop(m.get("_cookiefile"))
    cmd = [("<cookies>" if i and cmd[i - 1] == "--cookies" else a) for i, a in enumerate(cmd)]

    with open(os.path.join(LOG_DIR, time.strftime("%Y%m%d-%H%M%S") + ".log"), "w", encoding="utf-8") as fh:
        fh.write(" ".join(cmd) + "\n\n" + "\n".join(out_lines) + "\n" + err)

    job["updated"] = time.time()
    if p.returncode == 0:
        job.update(status="done", pct=100)
        write_job(job)
        notify("Pobrano ✓", os.path.basename(job["file"] or "") or "Gotowe")
    else:
        job.update(status="error", error=nice_error(err, "nieznany błąd"))
        write_job(job)
        notify("Błąd pobierania", job["error"])


def list_jobs():
    os.makedirs(JOB_DIR, exist_ok=True)
    jobs, now = [], time.time()
    for fn in os.listdir(JOB_DIR):
        path = os.path.join(JOB_DIR, fn)
        if not fn.endswith(".json"):
            continue
        try:
            with open(path, encoding="utf-8") as fh:
                j = json.load(fh)
        except Exception:  # noqa: BLE001
            continue
        if now - j.get("updated", 0) > 86400:
            os.remove(path)
            continue
        jobs.append(j)
    jobs.sort(key=lambda j: j.get("started", 0), reverse=True)
    return {"ok": True, "jobs": jobs[:10]}


def start_download(m):
    if not m.get("post"):
        ytdlp()  # sprawdź od razu, żeby błąd wrócił do popupu
    os.makedirs(LOG_DIR, exist_ok=True)
    os.makedirs(JOB_DIR, exist_ok=True)
    tmp_dir = os.path.join(APP_DIR, "tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    m["job"] = f"{time.time_ns()}-{os.urandom(2).hex()}"  # rośnie w czasie = kolejność w kolejce
    spec = os.path.join(tmp_dir, f"job-{m['job']}.json")
    with open(spec, "w", encoding="utf-8") as fh:
        json.dump(m, fh)
    exe = sys.executable
    extra = {"start_new_session": True}  # przeżyje zamknięcie połączenia z przeglądarką
    if WIN:
        pyw = os.path.join(os.path.dirname(exe), "pythonw.exe")
        exe = pyw if os.path.exists(pyw) else exe
        extra = {"creationflags": subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
                 | subprocess.CREATE_BREAKAWAY_FROM_JOB | NO_WINDOW}
    args = [exe, os.path.abspath(__file__), "--worker", spec]
    errlog = open(os.path.join(LOG_DIR, "worker-errors.log"), "a")
    try:
        subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=errlog, **extra)
    except OSError:
        if not WIN:
            raise
        # przeglądarka nie pozwala wyjść z job object — próbujemy bez tego
        extra["creationflags"] &= ~subprocess.CREATE_BREAKAWAY_FROM_JOB
        subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=errlog, **extra)
    return {"ok": True, "job": m["job"]}


def pick_folder():
    if WIN:
        ps = ("Add-Type -AssemblyName System.Windows.Forms;"
              "[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
              "$f=New-Object System.Windows.Forms.FolderBrowserDialog;"
              "$f.Description='Wybierz folder dla Potok Video';"
              "$o=New-Object System.Windows.Forms.Form -Property @{TopMost=$true};"
              "if($f.ShowDialog($o) -eq 'OK'){$f.SelectedPath}")
        r = run_quiet(["powershell", "-NoProfile", "-STA", "-Command", ps])
    else:
        r = run_quiet(["osascript", "-e",
                       'tell application (path to frontmost application as text) to '
                       'POSIX path of (choose folder with prompt "Wybierz folder dla Potok Video")'])
    path = (r.stdout or "").strip()
    if not path:
        return {"ok": False, "cancel": True}
    return {"ok": True, "path": path.rstrip("/\\") or path}


def maybe_update():
    """Co 3 dni po cichu aktualizuje yt-dlp — serwisy często zmieniają odtwarzacze."""
    stamp = os.path.join(APP_DIR, "last_update")
    try:
        if time.time() - os.path.getmtime(stamp) < 3 * 86400:
            return
    except OSError:
        pass
    os.makedirs(APP_DIR, exist_ok=True)
    with open(stamp, "w") as fh:
        fh.write(time.strftime("%Y-%m-%d %H:%M"))
    log = open(os.path.join(LOG_DIR, "update.log"), "a")
    if WIN:
        if not shutil.which("winget"):
            return
        cmd = ["winget", "upgrade", "--id", "yt-dlp.yt-dlp", "-e", "--silent",
               "--accept-source-agreements", "--accept-package-agreements"]
        extra = {"creationflags": subprocess.DETACHED_PROCESS | NO_WINDOW}
    else:
        brew = shutil.which("brew")
        if not brew:
            return
        cmd = ["/bin/sh", "-c", f'"{brew}" update -q && "{brew}" upgrade yt-dlp']
        extra = {"start_new_session": True}
    try:
        subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=log, stderr=log, **extra)
    except OSError:
        pass


def handle(m):
    action = m.get("action")
    if action == "probe":
        try:
            os.makedirs(LOG_DIR, exist_ok=True)
            maybe_update()
        except Exception:  # noqa: BLE001
            pass
    if action == "ping":
        return {"ok": True, "ytdlp": bool(shutil.which("yt-dlp")), "ffmpeg": bool(shutil.which("ffmpeg"))}
    if action == "probe":
        return probe(m)
    if action in ("download", "post"):
        if action == "post":
            if not m.get("path") or not os.path.exists(m["path"]):
                return {"ok": False, "error": "Brak pliku"}
            m["post"] = m["path"]
        return start_download(m)
    if action == "pick_folder":
        return pick_folder()
    if action == "jobs":
        return list_jobs()
    if action == "reveal" and m.get("path") and os.path.exists(m["path"]):
        if WIN:
            subprocess.Popen(f'explorer /select,"{os.path.normpath(m["path"])}"')
        else:
            subprocess.Popen(["open", "-R", m["path"]])
        return {"ok": True}
    if action == "clear_jobs":
        for j in list_jobs()["jobs"]:
            if j["status"] in ("done", "error"):
                os.remove(os.path.join(JOB_DIR, j["id"] + ".json"))
        return {"ok": True}
    if action == "open":
        d = out_dir(m)
        if WIN:
            os.startfile(d)
        else:
            subprocess.Popen(["open", d])
        return {"ok": True}
    if action == "defaults":
        return {"ok": True, "outDir": OUT_DIR}
    return {"ok": False, "error": f"Nieznana akcja: {action}"}


def main():
    if len(sys.argv) >= 3 and sys.argv[1] == "--worker":
        with open(sys.argv[2], encoding="utf-8") as fh:
            spec = json.load(fh)
        drop(sys.argv[2])
        worker(spec)
        return
    msg = read_msg()
    if msg is None:
        return
    try:
        send(handle(msg))
    except subprocess.TimeoutExpired:
        send({"ok": False, "error": "Przekroczony czas odczytu strony"})
    except Exception as e:  # noqa: BLE001
        send({"ok": False, "error": str(e)})


if __name__ == "__main__":
    main()
