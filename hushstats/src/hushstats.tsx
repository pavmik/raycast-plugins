import { Icon, MenuBarExtra, open } from "@raycast/api";
import { cpus, loadavg, uptime } from "os";
import { useEffect, useState } from "react";
import { BAR_ICONS, State, cached, clusterAverages, collect, copyAction, dot, gb, getBarIcon, ic, killProc, lvl, setBarIcon, severities } from "./metrics";

export default function Command() {
  const [s, setS] = useState<State | null>(cached);

  useEffect(() => {
    (async () => {
      setS(await collect());
    })();
  }, []);

  const { thermSev, cpuSev, gpuSev, memSev, batSev, diskSev, worst } = severities(s);
  const { pAvg, eAvg } = clusterAverages(s);
  const load = loadavg();
  const up = uptime();
  const upTxt = `${Math.floor(up / 86400)}d ${Math.floor((up % 86400) / 3600)}h`;
  const bootTxt = new Date(Date.now() - up * 1000).toLocaleString();

  // The bar shows the icon of whichever subsystem currently carries the most weight, so a
  // glance tells you what is wrong. At rest it stays a plain dot and blends in.
  const contenders: { sev: number; icon: Icon; what: string }[] = [
    { sev: cpuSev, icon: Icon.Waveform, what: `CPU ${s?.cpu.avg.toFixed(0) ?? "-"}%` },
    { sev: gpuSev, icon: Icon.Monitor, what: `GPU ${s?.gpu?.toFixed(0) ?? "-"}%` },
    { sev: memSev, icon: Icon.MemoryStick, what: `Memory ${s?.mem.pct.toFixed(0) ?? "-"}%` },
    { sev: s?.disk?.sev ?? 0, icon: Icon.HardDrive, what: `Disk ${s?.disk?.pct ?? "-"}%` },
    { sev: s?.backup?.sev ?? 0, icon: Icon.ArrowClockwise, what: `Backup ${s?.backup?.age ?? ""}` },
  ];
  const top = contenders.reduce((a, b) => (b.sev > a.sev ? b : a));
  // One fixed shape. A shape that changes with whatever is currently worst turned out to
  // be more distracting than informative - it flickers between subsystems as readings
  // cross each other. Colour carries the state; the tooltip names the culprit.
  const barIcon = (Icon[getBarIcon() as keyof typeof Icon] ?? Icon.LineChart) as Icon;
  const barTip = worst === 0 ? "hushstats - all good" : `hushstats - ${top.what}`;

  return (
    <MenuBarExtra icon={ic(barIcon, worst)} title={s?.bat.time ?? ""} tooltip={barTip} isLoading={!s}>
      {/* Sections mirror the four things the bar watches: CPU · GPU · MEM · System.
          Processes get their own titled section so they do not blend into the metrics. */}
      <MenuBarExtra.Section title="CPU">
        <MenuBarExtra.Item
          title="Load"
          subtitle={s ? `${s.cpu.avg.toFixed(0)}%` : "-"}
          icon={ic(Icon.Waveform, cpuSev)}
          onAction={() => open("/System/Applications/Utilities/Activity Monitor.app")}
        />
        {pAvg !== null && eAvg !== null && (
          <MenuBarExtra.Item
            title="Cores"
            subtitle={`P ${pAvg.toFixed(0)}%   ·   E ${eAvg.toFixed(0)}%`}
            icon={ic(Icon.Dot, lvl(Math.max(pAvg, eAvg), 20, 40, 60, 85))}
            onAction={copyAction("Cores", `P ${pAvg.toFixed(0)}% E ${eAvg.toFixed(0)}%`)}
          />
        )}
        <MenuBarExtra.Item
          title="Average"
          subtitle={`${load[0].toFixed(2)}  ${load[1].toFixed(2)}  ${load[2].toFixed(2)}   (${cpus().length} cores)`}
          icon={ic(Icon.Dot, lvl((load[0] / cpus().length) * 100, 40, 70, 100, 150))}
          onAction={copyAction("Load", load.map((l) => l.toFixed(2)).join(" "))}
        />
        {s?.therm && (
          <MenuBarExtra.Item
            title="Thermal"
            subtitle={s.therm}
            icon={ic(Icon.Temperature, thermSev)}
            onAction={copyAction("Thermal", s.therm)}
          />
        )}
        <MenuBarExtra.Submenu title="Top processes" icon={Icon.AppWindowList}>
          {s?.cpuProcs.map((p) => (
            <MenuBarExtra.Submenu key={`c${p.pid}`} title={`${p.name}   ${p.val.toFixed(1)}%`}>
              <MenuBarExtra.Item title={`Quit ${p.name}`} icon={Icon.XMarkCircle} onAction={() => killProc(p.pid, p.name)} />
              <MenuBarExtra.Item title="Force quit (SIGKILL)" icon={Icon.Trash} onAction={() => killProc(p.pid, p.name, true)} />
              <MenuBarExtra.Item title={`Copy PID ${p.pid}`} icon={Icon.Clipboard} onAction={copyAction("PID", String(p.pid))} />
            </MenuBarExtra.Submenu>
          ))}
        </MenuBarExtra.Submenu>
      </MenuBarExtra.Section>

      {s?.gpu != null && (
        <MenuBarExtra.Section title="GPU">
          <MenuBarExtra.Item
            title="Utilization"
            subtitle={`${s.gpu.toFixed(0)}%`}
            icon={ic(Icon.Monitor, gpuSev)}
            onAction={() => open("/System/Applications/Utilities/Activity Monitor.app")}
          />
        </MenuBarExtra.Section>
      )}

      <MenuBarExtra.Section title="Memory">
        <MenuBarExtra.Item
          title="Used"
          subtitle={s ? `${s.mem.pct.toFixed(0)}%   ${gb(s.mem.used)} / ${gb(s.mem.total)}` : "-"}
          icon={ic(Icon.MemoryStick, memSev)}
          onAction={() => open("/System/Applications/Utilities/Activity Monitor.app")}
        />
        {s?.swap && (
          <MenuBarExtra.Item
            title="Swap"
            subtitle={`${s.swap.used.toFixed(1)} / ${s.swap.total.toFixed(1)} GB`}
            icon={ic(Icon.Dot, 0)}
            onAction={copyAction("Swap", `${s.swap.used.toFixed(1)} GB`)}
          />
        )}
        {s && (
          <MenuBarExtra.Item
            title="Pressure"
            subtitle={s.press.name}
            icon={ic(Icon.Dot, s.press.sev === 4 ? 4 : 0)}
            onAction={copyAction("Pressure", s.press.name)}
          />
        )}
        <MenuBarExtra.Submenu title="Top processes" icon={Icon.AppWindowList}>
          {s?.memProcs.map((p) => (
            <MenuBarExtra.Submenu key={`m${p.pid}`} title={`${p.name}   ${p.val.toFixed(1)}%`}>
              <MenuBarExtra.Item title={`Quit ${p.name}`} icon={Icon.XMarkCircle} onAction={() => killProc(p.pid, p.name)} />
              <MenuBarExtra.Item title="Force quit (SIGKILL)" icon={Icon.Trash} onAction={() => killProc(p.pid, p.name, true)} />
              <MenuBarExtra.Item title={`Copy PID ${p.pid}`} icon={Icon.Clipboard} onAction={copyAction("PID", String(p.pid))} />
            </MenuBarExtra.Submenu>
          ))}
        </MenuBarExtra.Submenu>
      </MenuBarExtra.Section>

      <MenuBarExtra.Section title="System">
        {s?.disk && (
          <MenuBarExtra.Item
            title="Disk"
            subtitle={`${s.disk.pct}%   ${gb(s.disk.free)} free`}
            icon={ic(Icon.HardDrive, diskSev)}
            onAction={() => open("/System/Applications/Utilities/Disk Utility.app")}
          />
        )}
        {s && (
          <MenuBarExtra.Submenu
            title={`Battery   ${s.bat.pct}%${s.bat.charging ? " charging" : s.bat.time ? ` · ${s.bat.time} left` : ""}`}
            icon={ic(s.bat.charging ? Icon.BatteryCharging : Icon.Battery, batSev)}
          >
            {s.bat.watts !== null && (
              <MenuBarExtra.Item
                title="Power"
                subtitle={`${s.bat.watts.toFixed(1)} W  (${s.bat.charging ? "charging" : "draw"})`}
                icon={Icon.Bolt}
                onAction={copyAction("Power", `${s.bat.watts.toFixed(1)} W`)}
              />
            )}
            {s.bat.health !== null && (
              <MenuBarExtra.Item title="Health" subtitle={`${s.bat.health}%`} icon={Icon.Heartbeat} onAction={copyAction("Health", `${s.bat.health}%`)} />
            )}
            {s.bat.cycles !== null && (
              <MenuBarExtra.Item title="Cycle count" subtitle={String(s.bat.cycles)} icon={Icon.Repeat} onAction={copyAction("Cycles", String(s.bat.cycles))} />
            )}
            {s.bat.temp !== null && (
              <MenuBarExtra.Item title="Temperature" subtitle={`${s.bat.temp.toFixed(1)} °C`} icon={Icon.Temperature} onAction={copyAction("Temperature", `${s.bat.temp.toFixed(1)} °C`)} />
            )}
          </MenuBarExtra.Submenu>
        )}
        {s?.backup && (
          <MenuBarExtra.Submenu title={`Backup   ${s.backup.age}`} icon={ic(Icon.ArrowClockwise, s.backup.sev)}>
            <MenuBarExtra.Item title="Last backup" subtitle={s.backup.last} icon={Icon.Calendar} onAction={copyAction("Last backup", s.backup.last)} />
            <MenuBarExtra.Item
              title="Open Time Machine settings"
              icon={Icon.Gear}
              onAction={() => open("x-apple.systempreferences:com.apple.settings.TimeMachine")}
            />
          </MenuBarExtra.Submenu>
        )}
      </MenuBarExtra.Section>

      <MenuBarExtra.Section title="Network">
        {s?.net && (
          <MenuBarExtra.Item
            title="Throughput"
            subtitle={`↓ ${s.net.down}   ↑ ${s.net.up}`}
            icon={ic(Icon.Network, 0)}
            onAction={copyAction("Throughput", `${s.net.down} / ${s.net.up}`)}
          />
        )}
        {s?.ip && <MenuBarExtra.Item title="IP" subtitle={s.ip} icon={ic(Icon.Wifi, 0)} onAction={copyAction("IP", s.ip)} />}
        {s?.pubip && <MenuBarExtra.Item title="Ext IP" subtitle={s.pubip} icon={ic(Icon.Globe, 0)} onAction={copyAction("Ext IP", s.pubip)} />}
      </MenuBarExtra.Section>

      <MenuBarExtra.Section>
        <MenuBarExtra.Submenu title={`Uptime   ${upTxt}`} icon={ic(Icon.Clock, 0)}>
          <MenuBarExtra.Item title="Booted" subtitle={bootTxt} icon={Icon.Calendar} onAction={copyAction("Booted", bootTxt)} />
        </MenuBarExtra.Submenu>
      </MenuBarExtra.Section>

      <MenuBarExtra.Section>
        <MenuBarExtra.Submenu title="What the icon means" icon={Icon.QuestionMarkCircle}>
          <MenuBarExtra.Item
            title="The bar shows whatever needs attention most"
            subtitle={worst === 0 ? "right now: all good" : `right now: ${top.what}`}
            icon={ic(barIcon, worst)}
          />
          <MenuBarExtra.Item title="Its icon tells you which subsystem" subtitle="chip · display · memory · disk · battery" icon={Icon.Info} />
          <MenuBarExtra.Item title="Its colour tells you how bad" subtitle="grey → green → sand → peach → rose" icon={Icon.Info} />
          <MenuBarExtra.Item title="Text is the battery time left" subtitle="hidden while on AC power" icon={Icon.Info} />
          <MenuBarExtra.Item title="CPU / GPU thresholds" subtitle="20 / 40 / 60 / 85 %" icon={ic(Icon.Dot, 2)} />
          <MenuBarExtra.Item title="Memory thresholds" subtitle="60 / 75 / 85 / 93 %  ·  pressure overrides" icon={ic(Icon.Dot, 2)} />
          <MenuBarExtra.Item title="Disk thresholds" subtitle="70 / 80 / 90 / 95 % used" icon={ic(Icon.Dot, 2)} />
          <MenuBarExtra.Item title="Backup thresholds" subtitle="2d / 3d / 5d / 7d old" icon={ic(Icon.Dot, 2)} />
          <MenuBarExtra.Item title="Battery thresholds" subtitle="35 / 20 / 12 % left  ·  calm while charging" icon={ic(Icon.Dot, 2)} />
          <MenuBarExtra.Item title="Thermal throttling colours both CPU and GPU" subtitle="it is SoC-wide on Apple Silicon" icon={Icon.Info} />
          <MenuBarExtra.Item title="Click any row to copy its value" icon={Icon.Clipboard} />
        </MenuBarExtra.Submenu>
        <MenuBarExtra.Submenu title="Bar icon" icon={barIcon}>
          {BAR_ICONS.map((name) => (
            <MenuBarExtra.Item
              key={name}
              title={name === getBarIcon() ? `${name}  ✓` : name}
              icon={ic((Icon[name as keyof typeof Icon] ?? Icon.LineChart) as Icon, worst)}
              onAction={() => setBarIcon(name)}
            />
          ))}
        </MenuBarExtra.Submenu>
        <MenuBarExtra.Item
          title="Open Activity Monitor"
          icon={Icon.BarChart}
          onAction={() => open("/System/Applications/Utilities/Activity Monitor.app")}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
