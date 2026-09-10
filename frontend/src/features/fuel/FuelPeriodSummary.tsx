import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  CalendarRange,
  Droplets,
  Wallet,
  Gauge,
  Activity,
  Coins,
  Fuel,
  AlertTriangle,
  Inbox,
} from "lucide-react";
import api from "../../services/api/client";
import { formatAriary } from "../../services/formatAriary";
import ErrorState from "../../components/ErrorState";
import styles from "./FuelPeriodSummary.module.css";

type GroupBy = "day" | "week" | "month" | "year";

interface Bucket {
  key: string;
  periodStart: string;
  periodEnd: string;
  totalLiters: number;
  totalKm: number;
  totalCost: number;
  avgConsumption: number | null;
  costPerKm: number | null;
  logCount: number;
  anomalyCount: number;
}

interface SummaryResponse {
  groupBy: GroupBy;
  range: { from: string; to: string; clamped: boolean };
  buckets: Bucket[];
  totals: {
    totalLiters: number;
    totalKm: number;
    totalCost: number;
    avgConsumption: number | null;
    costPerKm: number | null;
    logCount: number;
    anomalyCount: number;
    periodCount: number;
    activePeriodCount: number;
  };
}

interface VehicleOpt {
  id: string;
  brand?: string;
  model?: string;
  licensePlate: string;
}

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** Libellé lisible d'une période selon la granularité. */
function periodLabel(iso: string, groupBy: GroupBy, short = false): string {
  const d = new Date(iso);
  if (groupBy === "year") return String(d.getUTCFullYear());
  if (groupBy === "month") {
    return d.toLocaleDateString("fr-FR", {
      month: short ? "short" : "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  if (groupBy === "week") {
    const day = d.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });
    return short ? day : `Sem. du ${day}`;
  }
  return d.toLocaleDateString("fr-FR", {
    weekday: short ? undefined : "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function ChartTip({
  active,
  payload,
  label,
  unit,
  money,
}: {
  active?: boolean;
  payload?: { value?: number }[];
  label?: string;
  unit?: string;
  money?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const v = typeof payload[0].value === "number" ? payload[0].value : 0;
  return (
    <div className={styles.tip}>
      <div className={styles.tipLabel}>{label}</div>
      <div className={styles.tipRow}>
        <b>{money ? formatAriary(Math.round(v)) : `${nf1.format(v)}${unit ? ` ${unit}` : ""}`}</b>
      </div>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  unit,
  sub,
  subWarn,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  subWarn?: boolean;
  accent: string;
}) {
  return (
    <div className={styles.kpi} style={{ ["--accent" as string]: accent }}>
      <div className={styles.kpiHead}>
        {icon}
        <span>{label}</span>
      </div>
      <div className={styles.kpiValue}>
        {value}
        {unit && <span className={styles.kpiUnit}>{unit}</span>}
      </div>
      {sub && (
        <div className={`${styles.kpiSub} ${subWarn ? styles.kpiSubWarn : ""}`}>{sub}</div>
      )}
    </div>
  );
}

export default function FuelPeriodSummary({ vehicles }: { vehicles?: VehicleOpt[] }) {
  const { t } = useTranslation();
  const [groupBy, setGroupBy] = useState<GroupBy>("month");
  const [vehicleId, setVehicleId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const qs = useMemo(() => {
    const p = new URLSearchParams({ groupBy });
    if (vehicleId) p.set("vehicleId", vehicleId);
    if (from) p.set("from", new Date(`${from}T00:00:00`).toISOString());
    if (to) p.set("to", new Date(`${to}T23:59:59`).toISOString());
    return p.toString();
  }, [groupBy, vehicleId, from, to]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<SummaryResponse>({
    queryKey: ["fuel-summary", qs],
    queryFn: () => api.get(`/fuel-consumption/summary?${qs}`).then((r) => r.data),
    staleTime: 30_000,
  });

  const periods: { key: GroupBy; label: string }[] = [
    { key: "day", label: t("fuel.summary.day") },
    { key: "week", label: t("fuel.summary.week") },
    { key: "month", label: t("fuel.summary.month") },
    { key: "year", label: t("fuel.summary.year") },
  ];

  const chartData = useMemo(
    () =>
      (data?.buckets ?? []).map((b) => ({
        label: periodLabel(b.periodStart, groupBy, true),
        liters: b.totalLiters,
        cost: b.totalCost,
        cons: b.avgConsumption,
      })),
    [data, groupBy],
  );

  const hasActivity = (data?.totals.activePeriodCount ?? 0) > 0;
  const rows = data ? [...data.buckets].reverse() : [];

  return (
    <div className={styles.wrap}>
      {/* ── Filtres ─────────────────────────────────────────────── */}
      <div className={styles.filters}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>{t("fuel.summary.granularity")}</label>
          <div className={styles.segmented} role="group">
            {periods.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setGroupBy(p.key)}
                className={`${styles.segBtn} ${groupBy === p.key ? styles.segBtnActive : ""}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterField}>
          <label className={styles.filterLabel}>{t("fuel.summary.vehicle")}</label>
          <select
            className={styles.select}
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            <option value="">{t("fuel.summary.allVehicles")}</option>
            {(vehicles ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.licensePlate}
                {v.brand ? ` — ${v.brand}${v.model ? ` ${v.model}` : ""}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.filterField}>
          <label className={styles.filterLabel}>{t("fuel.summary.from")}</label>
          <input
            type="date"
            className={styles.dateInput}
            value={from}
            max={to || undefined}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>{t("fuel.summary.to")}</label>
          <input
            type="date"
            className={styles.dateInput}
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>

        {(from || to || vehicleId) && (
          <button
            type="button"
            className={styles.resetBtn}
            onClick={() => {
              setFrom("");
              setTo("");
              setVehicleId("");
            }}
          >
            {t("fuel.summary.reset")}
          </button>
        )}

        {data && (
          <div className={styles.rangeHint}>
            <CalendarRange size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
            {t("fuel.summary.rangeHint", {
              from: new Date(data.range.from).toLocaleDateString("fr-FR"),
              to: new Date(data.range.to).toLocaleDateString("fr-FR"),
            })}
            {data.range.clamped && ` · ${t("fuel.summary.clamped")}`}
          </div>
        )}
      </div>

      {isError && (
        <ErrorState description={t("fuel.summary.error")} onRetry={() => void refetch()} />
      )}

      {isLoading && (
        <>
          <div className={styles.skeleton} />
          <div className={styles.skeleton} style={{ height: 260 }} />
        </>
      )}

      {data && !isError && (
        <>
          {/* ── KPI de la fenêtre ─────────────────────────────── */}
          <div className={styles.kpis}>
            <Kpi
              icon={<Droplets size={15} />}
              label={t("fuel.summary.kpiLiters")}
              value={nf.format(data.totals.totalLiters)}
              unit={t("fuel.unitLiters")}
              accent="var(--color-teal, #14b8a6)"
            />
            <Kpi
              icon={<Wallet size={15} />}
              label={t("fuel.summary.kpiCost")}
              value={formatAriary(data.totals.totalCost)}
              accent="var(--color-accent, #10b981)"
            />
            <Kpi
              icon={<Gauge size={15} />}
              label={t("fuel.summary.kpiDistance")}
              value={nf.format(data.totals.totalKm)}
              unit={t("fuel.unitKm")}
              accent="var(--color-blue, #3b82f6)"
            />
            <Kpi
              icon={<Activity size={15} />}
              label={t("fuel.summary.kpiAvg")}
              value={data.totals.avgConsumption != null ? nf1.format(data.totals.avgConsumption) : "—"}
              unit={data.totals.avgConsumption != null ? t("fuel.unitPer100") : undefined}
              accent="var(--color-purple, #8b5cf6)"
            />
            <Kpi
              icon={<Coins size={15} />}
              label={t("fuel.summary.kpiCostPerKm")}
              value={data.totals.costPerKm != null ? formatAriary(data.totals.costPerKm) : "—"}
              sub={data.totals.costPerKm != null ? t("fuel.summary.perKm") : undefined}
              accent="var(--color-warning, #f59e0b)"
            />
            <Kpi
              icon={<Fuel size={15} />}
              label={t("fuel.summary.kpiFills")}
              value={nf.format(data.totals.logCount)}
              sub={
                data.totals.anomalyCount > 0
                  ? t("fuel.summary.anomaliesN", { count: data.totals.anomalyCount })
                  : undefined
              }
              subWarn
              accent="var(--color-text-tertiary, #9ca3af)"
            />
          </div>

          {!hasActivity ? (
            <div className={styles.empty}>
              <Inbox size={28} />
              <p className={styles.emptyTitle}>{t("fuel.summary.emptyTitle")}</p>
              <p>{t("fuel.summary.emptyText")}</p>
            </div>
          ) : (
            <>
              {/* ── Graphes (un axe chacun) ─────────────────── */}
              <div className={styles.charts}>
                <div className={styles.chartCard}>
                  <div className={styles.chartTitle}>
                    {t("fuel.summary.chartCost")}
                    <small>Ar</small>
                  </div>
                  <ResponsiveContainer width="100%" height={230}>
                    <BarChart data={chartData} margin={{ top: 6, right: 6, left: 6 }}>
                      <defs>
                        <linearGradient id="fuelSumCost" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-accent, #10b981)" stopOpacity={0.95} />
                          <stop offset="100%" stopColor="var(--color-accent, #10b981)" stopOpacity={0.4} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e5e7eb)" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: "var(--color-text-tertiary, #9ca3af)" }}
                        axisLine={false}
                        tickLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "var(--color-text-tertiary, #9ca3af)" }}
                        axisLine={false}
                        tickLine={false}
                        width={64}
                        tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                      />
                      <Tooltip
                        content={<ChartTip money />}
                        cursor={{ fill: "var(--color-surface-hover, #f3f4f6)", opacity: 0.5 }}
                      />
                      <Bar dataKey="cost" fill="url(#fuelSumCost)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className={styles.chartCard}>
                  <div className={styles.chartTitle}>
                    {t("fuel.summary.chartConsumption")}
                    <small>{t("fuel.unitPer100")}</small>
                  </div>
                  <ResponsiveContainer width="100%" height={230}>
                    <BarChart data={chartData} margin={{ top: 6, right: 6, left: 6 }}>
                      <defs>
                        <linearGradient id="fuelSumCons" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-purple, #8b5cf6)" stopOpacity={0.95} />
                          <stop offset="100%" stopColor="var(--color-purple, #8b5cf6)" stopOpacity={0.4} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e5e7eb)" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: "var(--color-text-tertiary, #9ca3af)" }}
                        axisLine={false}
                        tickLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "var(--color-text-tertiary, #9ca3af)" }}
                        axisLine={false}
                        tickLine={false}
                        width={40}
                      />
                      <Tooltip
                        content={<ChartTip unit={t("fuel.unitPer100")} />}
                        cursor={{ fill: "var(--color-surface-hover, #f3f4f6)", opacity: 0.5 }}
                      />
                      <Bar dataKey="cons" fill="url(#fuelSumCons)" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* ── Tableau détaillé ────────────────────────── */}
              <div className={styles.tableCard}>
                <div className={styles.tableHead}>
                  <CalendarRange size={16} />
                  {t("fuel.summary.tableTitle")}
                  {isFetching && <span className={styles.dash}> · {t("common.loading")}</span>}
                </div>
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>{t("fuel.summary.colPeriod")}</th>
                        <th>{t("fuel.summary.colLiters")}</th>
                        <th>{t("fuel.summary.colCost")}</th>
                        <th>{t("fuel.summary.colDistance")}</th>
                        <th>{t("fuel.summary.colAvg")}</th>
                        <th>{t("fuel.summary.colCostPerKm")}</th>
                        <th>{t("fuel.summary.colFills")}</th>
                        <th>{t("fuel.summary.colAnomalies")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((b) => (
                        <tr key={b.key} className={b.logCount === 0 ? styles.rowEmpty : ""}>
                          <td className={styles.period}>{periodLabel(b.periodStart, groupBy)}</td>
                          <td>{b.logCount ? `${nf1.format(b.totalLiters)} L` : <span className={styles.dash}>—</span>}</td>
                          <td>{b.logCount ? formatAriary(b.totalCost) : <span className={styles.dash}>—</span>}</td>
                          <td>{b.logCount ? `${nf.format(b.totalKm)} km` : <span className={styles.dash}>—</span>}</td>
                          <td>
                            {b.avgConsumption != null ? (
                              `${nf1.format(b.avgConsumption)}`
                            ) : (
                              <span className={styles.dash}>—</span>
                            )}
                          </td>
                          <td>
                            {b.costPerKm != null ? formatAriary(b.costPerKm) : <span className={styles.dash}>—</span>}
                          </td>
                          <td>{b.logCount || <span className={styles.dash}>0</span>}</td>
                          <td>
                            {b.anomalyCount > 0 ? (
                              <span className={styles.anomalyBadge}>
                                <AlertTriangle size={11} />
                                {b.anomalyCount}
                              </span>
                            ) : (
                              <span className={styles.dash}>—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      <tr className={styles.rowTotal}>
                        <td>{t("fuel.summary.total")}</td>
                        <td>{nf1.format(data.totals.totalLiters)} L</td>
                        <td>{formatAriary(data.totals.totalCost)}</td>
                        <td>{nf.format(data.totals.totalKm)} km</td>
                        <td>
                          {data.totals.avgConsumption != null ? nf1.format(data.totals.avgConsumption) : "—"}
                        </td>
                        <td>{data.totals.costPerKm != null ? formatAriary(data.totals.costPerKm) : "—"}</td>
                        <td>{data.totals.logCount}</td>
                        <td>{data.totals.anomalyCount || "—"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
