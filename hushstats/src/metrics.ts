import { Cache, Clipboard, Color, Icon, LocalStorage, showHUD } from "@raycast/api";
import { execFile } from "child_process";
import { cpus, loadavg, totalmem, uptime } from "os";
import { promisify } from "util";

const run = promisify(execFile);

// Cache is synchronous, unlike LocalStorage - so the last known state can be rendered
// immediately on mount and only repainted once fresh numbers arrive. Without it the menu
// bar flashes Raycast's placeholder icon on every refresh.
const cache = new Cache();

// Same cold-to-warm pastel scale as the SwiftBar plugin, mid-brightness so the shades
// stay readable on both a light and a dark menu bar.
const PAL = ["#9BA7B4", "#A3C4A8", "#E8CE8F", "#E8AE8A", "#DE9A9A"];

const THERMAL_HELPER = `${process.env.HOME}/Library/Application Support/swiftbar-hushstats/thermal-helper`;

/** Value -> severity 0-4 against this metric's own thresholds. */
function lvl(v: number, t1: number, t2: number, t3: number, t4: number) {
  return v >= t4 ? 4 : v >= t3 ? 3 : v >= t2 ? 2 : v >= t1 ? 1 : 0;
}

/** Icon says what the row is about, tint says how bad it is. */
function ic(source: Icon, sev: number) {
  return { source, tintColor: PAL[sev] as Color.ColorLike };
}

/** Processes have no meaningful icon of their own, so they keep a plain dot. */
function dot(sev: number) {
  return { source: Icon.Dot, tintColor: PAL[sev] as Color.ColorLike };
}

function gb(bytes: number) {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

async function sh(cmd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run(cmd, args, { timeout: 3000 });
    return stdout;
  } catch {
    return "";
  }
}

/** Per-core utilisation from two os.cpus() samples - Node has no direct reading. */
async function cpuSample(ms = 400) {
  const snap = () => cpus().map((c) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
  const a = snap();
  await new Promise((r) => setTimeout(r, ms));
  const b = snap();
  const per = b.map((core, i) => {
    const idle = core.idle - a[i].idle;
    const total = core.total - a[i].total;
    return total > 0 ? Math.max(0, Math.min(100, (1 - idle / total) * 100)) : 0;
  });
  const avg = per.reduce((x, y) => x + y, 0) / per.length;
  return { per, avg };
}

/**
 * Four sysctl readings in a single call: core clusters, memory pressure and swap. Each
 * spawned process is a CPU wakeup, and on a fanless Mac those cost more battery than the
 * work itself, so the collectors share one call wherever the tool allows it.
 */
async function sysctlBatch() {
  const out = await sh("/usr/sbin/sysctl", [
    "-n",
    "hw.perflevel0.logicalcpu",
    "hw.perflevel1.logicalcpu",
    "kern.memorystatus_vm_pressure_level",
    "vm.swapusage",
  ]);
  const lines = out.trim().split("\n");
  const press = Number(lines[2]);
  const sw = lines.slice(3).join(" ").match(/total = ([\d.]+)M\s+used = ([\d.]+)M/);
  return {
    cores: { p: Number(lines[0]) || 0, e: Number(lines[1]) || 0 },
    press: { name: press === 4 ? "critical" : press === 2 ? "warning" : "normal", sev: press === 4 ? 4 : press === 2 ? 2 : 0 },
    swap: sw ? { used: Number(sw[2]) / 1024, total: Number(sw[1]) / 1024 } : null,
  };
}

/**
 * Memory used %, the way macOS counts it. os.freemem() only reports genuinely free pages
 * and ignores inactive ones, which reads as ~99% used on a healthy machine - useless.
 */
async function memory() {
  const out = await sh("/usr/bin/vm_stat", []);
  const pageSize = Number(out.match(/page size of (\d+) bytes/)?.[1] ?? 4096);
  const pages = (label: string) => Number(out.match(new RegExp(`${label}:\\s+(\\d+)`))?.[1] ?? 0);
  const available = (pages("Pages free") + pages("Pages inactive")) * pageSize;
  const total = totalmem();
  return { pct: total > 0 ? ((total - available) / total) * 100 : 0, used: total - available, total };
}

/**
 * GPU utilization from ioreg. This counter measures a very short window since the last
 * read, so two ioreg calls close together leave the second one reading zero. It must be
 * sampled on its own, before anything else touches ioreg.
 */
async function gpuUtil(): Promise<number | null> {
  const out = await sh("/usr/sbin/ioreg", ["-r", "-c", "IOAccelerator", "-d", "1", "-w", "0"]);
  const m = out.match(/"Device Utilization %"=(\d+)/);
  return m ? Number(m[1]) : null;
}

/** pmset -g therm is Intel-only, so thermal state comes from a Swift helper. */
async function thermal(): Promise<string | null> {
  const out = (await sh(THERMAL_HELPER, [])).trim();
  return ["nominal", "fair", "serious", "critical"].includes(out) ? out : null;
}

/** Battery: charge, time, and the internals ioreg hands over for free. */
async function battery() {
  const p = await sh("/usr/bin/pmset", ["-g", "batt"]);
  const pct = Number(p.match(/(\d+)%/)?.[1] ?? 0);
  // "charging" is a substring of "discharging" - match the whole state word, not a
  // fragment. pmset prints "charging", "discharging", "AC attached" or "finishing charge".
  const onAC = /AC Power/i.test(p);
  const charging = onAC && !/\bdischarging\b/i.test(p);
  const hhmm = p.match(/(\d+):(\d\d)\s+remaining/);
  let time = "";
  if (hhmm) {
    const mins = Number(hhmm[1]) * 60 + Number(hhmm[2]);
    time = mins >= 60 ? `${Math.floor(mins / 60)}h` : `${mins}m`;
  }
  const io = await sh("/usr/sbin/ioreg", ["-rn", "AppleSmartBattery", "-w", "0"]);
  const num = (k: string) => {
    const m = io.match(new RegExp(`"${k}" = (-?\\d+)`));
    return m ? Number(m[1]) : null;
  };
  const design = num("DesignCapacity");
  const maxCap = num("AppleRawMaxCapacity") ?? num("NominalChargeCapacity");
  const temp = num("Temperature");
  let watts: number | null = null;
  const amp = num("InstantAmperage");
  const volt = num("Voltage");
  if (amp !== null && volt) watts = Math.abs(amp) * volt / 1e6;
  return {
    pct,
    charging,
    time,
    health: design && maxCap ? Math.round((maxCap / design) * 100) : null,
    cycles: num("CycleCount"),
    temp: temp ? temp / 100 : null,
    watts,
  };
}

/** Real destination backups, not local APFS snapshots (those are always fresh). */
async function backup() {
  const out = await sh("/usr/bin/defaults", ["read", "/Library/Preferences/com.apple.TimeMachine.plist", "Destinations"]);
  if (!out) return null;
  const dates = out.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g);
  if (!dates?.length) return null;
  const last = new Date(dates.sort().at(-1)!.replace(" ", "T") + "Z");
  const hours = (Date.now() - last.getTime()) / 3.6e6;
  const age = hours < 1 ? `${Math.round(hours * 60)}m ago` : hours < 48 ? `${Math.round(hours)}h ago` : `${Math.round(hours / 24)}d ago`;
  return { age, sev: lvl(hours, 120, 168, 240, 336), last: last.toLocaleString() };
}

async function disk() {
  const out = await sh("/bin/df", ["-k", "/"]);
  const m = out.split("\n")[1]?.match(/\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%/);
  if (!m) return null;
  const pct = Number(m[4]);
  return { pct, free: Number(m[3]) * 1024, sev: lvl(pct, 70, 80, 90, 95) };
}

async function localIp() {
  const iface = (await sh("/sbin/route", ["get", "default"])).match(/interface:\s*(\S+)/)?.[1] ?? "en0";
  return (await sh("/usr/sbin/ipconfig", ["getifaddr", iface])).trim();
}

/** Public IP, cached so a 10s menu bar refresh does not hammer the network. */
async function extIp(): Promise<string> {
  const cached = await LocalStorage.getItem<string>("extip");
  const at = Number((await LocalStorage.getItem<string>("extip_at")) ?? 0);
  if (cached && Date.now() - at < 300_000) return cached;
  const out = (await sh("/usr/bin/curl", ["-s", "--max-time", "2", "https://ifconfig.co"])).trim();
  const ip = /^[0-9a-fA-F.:]{3,45}$/.test(out) ? out : "";
  if (ip) {
    await LocalStorage.setItem("extip", ip);
    await LocalStorage.setItem("extip_at", String(Date.now()));
  }
  return ip || cached || "";
}

/**
 * Network throughput. Interface counters are cumulative, so a rate needs the previous
 * sample - which LocalStorage carries between background runs.
 */
async function network(): Promise<{ down: string; up: string } | null> {
  const out = await sh("/usr/sbin/netstat", ["-ib"]);
  let rx = 0, tx = 0;
  for (const line of out.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length > 9 && f[0].startsWith("en") && f[2].startsWith("<Link")) {
      rx += Number(f[6]) || 0;
      tx += Number(f[9]) || 0;
    }
  }
  const now = Date.now();
  const prev = await LocalStorage.getItem<string>("net");
  await LocalStorage.setItem("net", JSON.stringify({ rx, tx, t: now }));
  if (!prev) return null;
  const o = JSON.parse(prev) as { rx: number; tx: number; t: number };
  const dt = (now - o.t) / 1000;
  if (dt <= 0) return null;
  const rate = (b: number) => {
    const v = Math.max(0, b) / dt;
    return v > 1e6 ? `${(v / 1e6).toFixed(1)} MB/s` : v > 1e3 ? `${(v / 1e3).toFixed(0)} KB/s` : `${v.toFixed(0)} B/s`;
  };
  return { down: rate(rx - o.rx), up: rate(tx - o.tx) };
}

/** One ps call for both lists - sorting by memory afterwards is free. */
async function allProcs() {
  const out = await sh("/bin/ps", ["-Aco", "pid,pcpu,pmem,comm", "-r"]);
  const rows = out
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => {
      const m = l.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.*)$/);
      return { pid: Number(m?.[1] ?? 0), cpu: Number(m?.[2] ?? 0), mem: Number(m?.[3] ?? 0), name: (m?.[4] ?? "").slice(0, 24) };
    })
    .filter((p) => p.name && p.pid);
  return {
    byCpu: rows.slice(0, 5).map((p) => ({ pid: p.pid, val: p.cpu, name: p.name })),
    byMem: [...rows].sort((a, b) => b.mem - a.mem).slice(0, 5).map((p) => ({ pid: p.pid, val: p.mem, name: p.name })),
  };
}

/** Raycast dims menu items that have no action, so every row gets one: copying its
 *  value is both useful and enough to keep the menu readable. */
function copyAction(label: string, value: string) {
  return async () => {
    await Clipboard.copy(value);
    await showHUD(`Copied ${label}: ${value}`);
  };
}

async function killProc(pid: number, name: string, force = false) {
  await sh("/bin/kill", force ? ["-9", String(pid)] : [String(pid)]);
  await showHUD(`${force ? "Force quit" : "Quit"} ${name}`);
}

export interface State {
  cpu: Awaited<ReturnType<typeof cpuSample>>;
  cores: { p: number; e: number };
  gpu: number | null;
  therm: string | null;
  mem: Awaited<ReturnType<typeof memory>>;
  swap: { used: number; total: number } | null;
  press: { name: string; sev: number };
  bat: Awaited<ReturnType<typeof battery>>;
  disk: Awaited<ReturnType<typeof disk>>;
  backup: Awaited<ReturnType<typeof backup>>;
  ip: string;
  cpuProcs: { pid: number; val: number; name: string }[];
  memProcs: { pid: number; val: number; name: string }[];
  pubip: string;
  net: Awaited<ReturnType<typeof network>>;
}


/**
 * One full sample. GPU is read first and alone on purpose: its ioreg counter covers a
 * very short window since the last read, so a concurrent ioreg call zeroes it out.
 */
export async function collect(): Promise<State> {
  const gpu = await gpuUtil();
  const [cpu, sysctls, therm, mem, bat, dsk, bkp, ip, allP, pubip, net] = await Promise.all([
    cpuSample(),
    sysctlBatch(),
    thermal(),
    memory(),
    battery(),
    slow("disk", 60_000, disk),
    slow("backup", 300_000, backup),
    slow("ip", 60_000, localIp),
    allProcs(),
    extIp(),
    network(),
  ]);
  const fresh: State = {
    cpu, cores: sysctls.cores, gpu, therm, mem, swap: sysctls.swap, press: sysctls.press,
    bat, disk: dsk, backup: bkp, ip, cpuProcs: allP.byCpu, memProcs: allP.byMem, pubip, net,
  };
  cache.set("state", JSON.stringify(fresh));
  return fresh;
}

/**
 * Slow-moving data does not need re-reading every cycle. Backup age, disk usage and the
 * local IP change on the scale of minutes, so they are cached and their processes are
 * spawned once a minute instead of on every refresh - fewer wakeups, less battery.
 */
async function slow<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const raw = cache.get(`slow:${key}`);
  if (raw) {
    try {
      const { t, v } = JSON.parse(raw) as { t: number; v: T };
      if (Date.now() - t < ttlMs) return v;
    } catch {
      /* fall through and refetch */
    }
  }
  const v = await fn();
  cache.set(`slow:${key}`, JSON.stringify({ t: Date.now(), v }));
  return v;
}

/** Menu-bar icon, chosen from the menu and remembered. Cache is synchronous, so the
 *  choice applies on the very first render instead of one frame late. */
export const BAR_ICONS = [
  "LineChart", "Gauge", "Waveform", "BarChart", "Heartbeat",
  "Livestream", "CircleProgress", "ComputerChip", "Desktop", "Bolt", "CircleFilled",
] as const;

export function getBarIcon(): string {
  const v = cache.get("baricon");
  return v && (BAR_ICONS as readonly string[]).includes(v) ? v : "LineChart";
}

export function setBarIcon(name: string) {
  cache.set("baricon", name);
}

/** Last known sample, so a view can paint instantly instead of flashing a spinner. */
export function cached(): State | null {
  try {
    const c = cache.get("state");
    return c ? (JSON.parse(c) as State) : null;
  } catch {
    return null;
  }
}

/** Severity per subsystem, shared by both commands so they can never disagree. */
export function severities(s: State | null) {
  const thermSev = s?.therm === "critical" ? 4 : s?.therm === "serious" ? 3 : s?.therm === "fair" ? 1 : 0;
  const cpuSev = Math.max(s ? lvl(s.cpu.avg, 20, 40, 60, 85) : 0, thermSev);
  const gpuSev = Math.max(s?.gpu != null ? lvl(s.gpu, 20, 40, 60, 85) : 0, thermSev);
  // macOS reports pressure "warning" routinely once RAM is full without anything actually
  // suffering, so it stays a menu-only note. Only "critical" is worth colouring the bar.
  // macOS deliberately keeps RAM full, so 80% used is a healthy machine, not a warning.
  // Only genuinely tight memory (or a critical pressure reading) is worth colouring.
  const memSev = s?.press.sev === 4 ? 4 : 0;
  const batSev = !s || s.bat.charging ? 0 : lvl(100 - s.bat.pct, 50, 65, 80, 88);
  // Battery is deliberately kept out of the bar colour: running on battery is normal, not
  // an alert. It still colours its own row in the menu, just not the whole icon.
  const diskSev = s && s.disk && s.disk.pct >= 90 ? s.disk.sev : 0;
  const sysSev = Math.max(diskSev, s?.backup?.sev ?? 0);
  return { thermSev, cpuSev, gpuSev, memSev, batSev, diskSev, sysSev, worst: Math.max(cpuSev, gpuSev, memSev, sysSev) };
}

/** Per-cluster averages. P-cores come first in the core list on Apple Silicon. */
export function clusterAverages(s: State | null) {
  if (!s || !s.cores.p || !s.cores.e) return { pAvg: null, eAvg: null };
  const p = s.cpu.per.slice(0, s.cores.p);
  const e = s.cpu.per.slice(s.cores.p);
  return {
    pAvg: p.reduce((a, b) => a + b, 0) / p.length,
    eAvg: e.reduce((a, b) => a + b, 0) / e.length,
  };
}

export { lvl, ic, dot, gb, copyAction, killProc, PAL };
