import { Action, ActionPanel, Color, Icon, List, open } from "@raycast/api";
import { cpus, loadavg, uptime } from "os";
import { useEffect, useState } from "react";
import { State, cached, clusterAverages, collect, gb, killProc, lvl, severities, PAL } from "./metrics";

/** Same pastel scale as the menu bar, as a List accessory tag. */
function tag(value: string, sev: number) {
  return { tag: { value, color: PAL[sev] as Color.ColorLike } };
}

export default function Status() {
  // paint the last known sample immediately, then refresh
  const [s, setS] = useState<State | null>(cached);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    setS(await collect());
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const { thermSev, cpuSev, gpuSev, memSev, batSev } = severities(s);
  const { pAvg, eAvg } = clusterAverages(s);
  const load = loadavg();
  const up = uptime();
  const upTxt = `${Math.floor(up / 86400)}d ${Math.floor((up % 86400) / 3600)}h`;

  const common = (
    <ActionPanel>
      <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={refresh} />
      <Action
        title="Open Activity Monitor"
        icon={Icon.BarChart}
        onAction={() => open("/System/Applications/Utilities/Activity Monitor.app")}
      />
    </ActionPanel>
  );

  return (
    <List isLoading={loading} searchBarPlaceholder="Filter metrics and processes">
      <List.Section title="CPU">
        <List.Item
          icon={{ source: Icon.ComputerChip, tintColor: PAL[cpuSev] as Color.ColorLike }}
          title="Load"
          accessories={[tag(s ? `${s.cpu.avg.toFixed(0)}%` : "-", cpuSev)]}
          actions={common}
        />
        {pAvg !== null && eAvg !== null && (
          <List.Item
            icon={Icon.Dot}
            title="Cores"
            subtitle={`${cpus().length} total`}
            accessories={[tag(`P ${pAvg.toFixed(0)}%`, lvl(pAvg, 20, 40, 60, 85)), tag(`E ${eAvg.toFixed(0)}%`, lvl(eAvg, 20, 40, 60, 85))]}
            actions={common}
          />
        )}
        <List.Item
          icon={Icon.Dot}
          title="Load average"
          accessories={[{ text: `${load[0].toFixed(2)}  ${load[1].toFixed(2)}  ${load[2].toFixed(2)}` }]}
          actions={common}
        />
        {s?.therm && (
          <List.Item
            icon={{ source: Icon.Temperature, tintColor: PAL[thermSev] as Color.ColorLike }}
            title="Thermal"
            accessories={[tag(s.therm, thermSev)]}
            actions={common}
          />
        )}
      </List.Section>

      {s?.gpu != null && (
        <List.Section title="GPU">
          <List.Item
            icon={{ source: Icon.Monitor, tintColor: PAL[gpuSev] as Color.ColorLike }}
            title="Utilization"
            accessories={[tag(`${s.gpu.toFixed(0)}%`, gpuSev)]}
            actions={common}
          />
        </List.Section>
      )}

      <List.Section title="Memory">
        <List.Item
          icon={{ source: Icon.MemoryChip, tintColor: PAL[memSev] as Color.ColorLike }}
          title="Used"
          subtitle={s ? `${gb(s.mem.used)} / ${gb(s.mem.total)}` : ""}
          accessories={[tag(s ? `${s.mem.pct.toFixed(0)}%` : "-", memSev)]}
          actions={common}
        />
        {s?.swap && (
          <List.Item
            icon={Icon.Dot}
            title="Swap"
            accessories={[{ text: `${s.swap.used.toFixed(1)} / ${s.swap.total.toFixed(1)} GB` }]}
            actions={common}
          />
        )}
        {s && (
          <List.Item icon={Icon.Dot} title="Pressure" accessories={[tag(s.press.name, s.press.sev)]} actions={common} />
        )}
      </List.Section>

      <List.Section title="System">
        {s?.disk && (
          <List.Item
            icon={{ source: Icon.HardDrive, tintColor: PAL[s.disk.sev] as Color.ColorLike }}
            title="Disk"
            subtitle={`${gb(s.disk.free)} free`}
            accessories={[tag(`${s.disk.pct}%`, s.disk.sev)]}
            actions={common}
          />
        )}
        {s && (
          <List.Item
            icon={{ source: s.bat.charging ? Icon.BatteryCharging : Icon.Battery, tintColor: PAL[batSev] as Color.ColorLike }}
            title="Battery"
            subtitle={[
              s.bat.charging ? "charging" : s.bat.time ? `${s.bat.time} left` : "",
              s.bat.watts !== null ? `${s.bat.watts.toFixed(1)} W` : "",
              s.bat.health !== null ? `health ${s.bat.health}%` : "",
              s.bat.cycles !== null ? `${s.bat.cycles} cycles` : "",
              s.bat.temp !== null ? `${s.bat.temp.toFixed(1)} °C` : "",
            ]
              .filter(Boolean)
              .join("  ·  ")}
            accessories={[tag(`${s.bat.pct}%`, batSev)]}
            actions={common}
          />
        )}
        {s?.backup && (
          <List.Item
            icon={{ source: Icon.ArrowClockwise, tintColor: PAL[s.backup.sev] as Color.ColorLike }}
            title="Backup"
            subtitle={s.backup.last}
            accessories={[tag(s.backup.age, s.backup.sev)]}
            actions={
              <ActionPanel>
                <Action
                  title="Open Time Machine Settings"
                  icon={Icon.Gear}
                  onAction={() => open("x-apple.systempreferences:com.apple.settings.TimeMachine")}
                />
                <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={refresh} />
              </ActionPanel>
            }
          />
        )}
      </List.Section>

      <List.Section title="Network">
        {s?.net && (
          <List.Item
            icon={Icon.Network}
            title="Throughput"
            accessories={[{ text: `↓ ${s.net.down}   ↑ ${s.net.up}` }]}
            actions={common}
          />
        )}
        {s?.ip && (
          <List.Item
            icon={Icon.Wifi}
            title="IP"
            accessories={[{ text: s.ip }]}
            actions={
              <ActionPanel>
                <Action.CopyToClipboard title="Copy IP" content={s.ip} />
                <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={refresh} />
              </ActionPanel>
            }
          />
        )}
        {s?.pubip && (
          <List.Item
            icon={Icon.Globe}
            title="Ext IP"
            accessories={[{ text: s.pubip }]}
            actions={
              <ActionPanel>
                <Action.CopyToClipboard title="Copy External IP" content={s.pubip} />
                <Action title="Refresh" icon={Icon.ArrowClockwise} onAction={refresh} />
              </ActionPanel>
            }
          />
        )}
        <List.Item icon={Icon.Clock} title="Uptime" accessories={[{ text: upTxt }]} actions={common} />
      </List.Section>

      <List.Section title="Top processes by CPU">
        {s?.cpuProcs.map((p) => (
          <List.Item
            key={`c${p.pid}`}
            icon={Icon.Dot}
            title={p.name}
            subtitle={`PID ${p.pid}`}
            accessories={[tag(`${p.val.toFixed(1)}%`, lvl(p.val, 20, 40, 60, 85))]}
            actions={
              <ActionPanel>
                <Action title={`Quit ${p.name}`} icon={Icon.XMarkCircle} onAction={() => killProc(p.pid, p.name).then(refresh)} />
                <Action
                  title="Force Quit (SIGKILL)"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={() => killProc(p.pid, p.name, true).then(refresh)}
                />
                <Action.CopyToClipboard title="Copy PID" content={String(p.pid)} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>

      <List.Section title="Top processes by memory">
        {s?.memProcs.map((p) => (
          <List.Item
            key={`m${p.pid}`}
            icon={Icon.Dot}
            title={p.name}
            subtitle={`PID ${p.pid}`}
            accessories={[tag(`${p.val.toFixed(1)}%`, lvl(p.val, 5, 10, 20, 30))]}
            actions={
              <ActionPanel>
                <Action title={`Quit ${p.name}`} icon={Icon.XMarkCircle} onAction={() => killProc(p.pid, p.name).then(refresh)} />
                <Action
                  title="Force Quit (SIGKILL)"
                  icon={Icon.Trash}
                  style={Action.Style.Destructive}
                  onAction={() => killProc(p.pid, p.name, true).then(refresh)}
                />
                <Action.CopyToClipboard title="Copy PID" content={String(p.pid)} />
              </ActionPanel>
            }
          />
        ))}
      </List.Section>
    </List>
  );
}
