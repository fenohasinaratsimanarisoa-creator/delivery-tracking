import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Pencil,
  Plus,
  Trash2,
  Fuel,
  Droplets,
  Wallet,
  Gauge,
  AlertTriangle,
  PenLine,
  Radar,
  CircleDollarSign,
  RefreshCw,
  CalendarDays,
  Info,
  Inbox,
  CheckCircle2,
  HelpCircle,
  Car,
  Calendar,
  Flame,
  Factory,
  Zap,
  Leaf,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  EyeOff,
} from "lucide-react";
import api from "../services/api/client";
import EntityDialog, {
  DialogField,
  DialogSection,
  DialogSubmitBar,
} from "../components/EntityDialog";
import ConfirmDialog from "../components/ConfirmDialog";
import { useToast } from "../components/Toast";
import { formatAriary } from "../services/formatAriary";
import type { FuelLog, Vehicle } from "../types";
import styles from "./FuelPage.module.css";

type ApiError = { response?: { data?: { message?: string } } };

interface FuelPrice {
  id: string;
  fuelType: string;
  pricePerLiter: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

interface ConsumptionStats {
  totalLiters: number;
  totalKilometers: number;
  totalCost: number;
  averageConsumption: number;
  anomalyCount: number;
  logCount: number;
}

interface GpsVehicleDiagnostics {
  vehicleId: string;
  vehiclePlate: string;
  driverName: string | null;
  fixCount: number;
  validCount: number;
  suspectCount: number;
  spanSec: number;
  avgGapSec: number;
  maxGapSec: number;
  longGapCount: number;
  coveragePercent: number;
  rawDistanceKm: number;
  filteredDistanceKm: number;
  reportDistanceKm: number | null;
  accuracyMin: number | null;
  accuracyMax: number | null;
  accuracyAvg: number | null;
  speedMaxMs: number | null;
  movingCount: number;
  speedReportedCount: number;
}

interface GpsDiagnostics {
  date: string;
  totalPositions: number;
  unattributedPositions: number;
  vehicles: GpsVehicleDiagnostics[];
}

const FUEL_TYPES = ["essence", "gasoil", "diesel", "electric", "hybrid"];

const FUEL_TYPE_COLORS: Record<string, string> = {
  essence: "var(--color-accent)",
  gasoil: "var(--color-teal)",
  diesel: "var(--color-blue)",
  electric: "var(--color-purple)",
  hybrid: "var(--color-warning)",
};

const FUEL_TYPE_ICONS: Record<string, React.ReactNode> = {
  essence: <Flame size={15} />,
  gasoil: <Droplets size={15} />,
  diesel: <Factory size={15} />,
  electric: <Zap size={15} />,
  hybrid: <Leaf size={15} />,
};

function useCountUp(target: number, decimals = 0, duration = 700) {
  const [value, setValue] = useState(target);
  useEffect(() => {
    const reduced =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;
    if (reduced) {
      setValue(target);
      return;
    }
    let raf: number;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const factor = Math.pow(10, decimals);
      setValue(Math.round(target * eased * factor) / factor);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, decimals, duration]);
  return value;
}

function KpiCard({
  icon,
  label,
  value,
  unit,
  color,
  delay,
  decimals = 0,
  format,
  pulse,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  unit?: string;
  color: string;
  delay: number;
  decimals?: number;
  format?: (n: number) => string;
  pulse?: boolean;
}) {
  const animated = useCountUp(value, decimals);
  const text = format
    ? format(animated)
    : animated.toLocaleString("fr-FR", {
        maximumFractionDigits: decimals,
        minimumFractionDigits: 0,
      });
  return (
    <div
      className={`${styles.kpiCard} ${pulse ? styles.kpiCardPulse : ""}`}
      style={{ ["--kpi" as string]: color, animationDelay: `${delay}ms` }}
    >
      <div className={styles.kpiTop}>
        <span className={styles.kpiIcon}>{icon}</span>
      </div>
      <div className={styles.kpiValue}>
        {text}
        {unit && <span className={styles.kpiUnit}>{unit}</span>}
      </div>
      <div className={styles.kpiLabel}>{label}</div>
    </div>
  );
}

function initials(name?: string) {
  if (!name) return "?";
  const parts = name.replace(/[()]/g, "").split(" ").filter(Boolean);
  return `${(parts[0]?.[0] || "").toUpperCase()}${(parts[1]?.[0] || "").toUpperCase()}`;
}

function gpsDur(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

export default function FuelPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<"manual" | "gps" | "prices">("manual");
  const [reportDate, setReportDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [diagOpen, setDiagOpen] = useState(false);
  const [editing, setEditing] = useState<FuelLog | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<FuelLog | null>(null);
  const [form, setForm] = useState({
    vehicleId: "",
    liters: "",
    kilometers: "",
    cost: "",
    fillDate: "",
    notes: "",
  });
  const [priceForm, setPriceForm] = useState({
    fuelType: "diesel",
    pricePerLiter: "",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveUntil: "",
  });
  const [addingPrice, setAddingPrice] = useState(false);
  const [editingPrice, setEditingPrice] = useState<FuelPrice | null>(null);
  const [deletingPrice, setDeletingPrice] = useState<FuelPrice | null>(null);
  const [defaultsDraft, setDefaultsDraft] = useState<Record<string, string>>(
    {},
  );
  const limit = 20;

  const { data, isLoading, error } = useQuery({
    queryKey: ["fuel-consumption", page],
    queryFn: () =>
      api
        .get(`/fuel-consumption?page=${page}&limit=${limit}`)
        .then((r) => r.data),
  });

  const { data: stats } = useQuery({
    queryKey: ["fuel-consumption-stats"],
    queryFn: () => api.get("/fuel-consumption/stats").then((r) => r.data),
    staleTime: 15000,
  });

  const { data: reports, isLoading: reportsLoading } = useQuery({
    queryKey: ["fuel-daily-reports", reportDate],
    queryFn: () =>
      api
        .get(`/fuel-consumption/daily-reports?date=${reportDate}`)
        .then((r) => r.data ?? r ?? []),
    enabled: tab === "gps",
  });

  const {
    data: diagnostics,
    isFetching: diagnosticsFetching,
    error: diagnosticsError,
  } = useQuery({
    queryKey: ["gps-diagnostics", reportDate],
    queryFn: () =>
      api
        .get(`/fuel-consumption/gps-diagnostics?date=${reportDate}`)
        .then((r) => r.data as GpsDiagnostics),
    enabled: tab === "gps" && diagOpen,
    staleTime: 30000,
  });

  const { data: vehicles } = useQuery({
    queryKey: ["vehicles", "list"],
    queryFn: () => api.get("/vehicles/list").then((r) => r.data),
    staleTime: 30000,
  });

  const { data: pricesData, isLoading: pricesLoading } = useQuery({
    queryKey: ["fuel-prices"],
    queryFn: () => api.get("/fuel-consumption/prices").then((r) => r.data),
    enabled: tab === "prices",
  });

  const defaultsKey = JSON.stringify(pricesData?.defaults ?? null);

  useEffect(() => {
    if (!pricesData?.defaults) return;
    const draft: Record<string, string> = {};
    for (const ft of FUEL_TYPES) {
      draft[ft] = String(pricesData.defaults[ft] ?? "");
    }
    setDefaultsDraft(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultsKey]);

  const generateMutation = useMutation({
    mutationFn: (date: string) =>
      api
        .post("/fuel-consumption/daily-reports/generate", { date })
        .then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["fuel-daily-reports", reportDate],
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Record<string, unknown>;
    }) => api.patch(`/fuel-consumption/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fuel-consumption"] });
      queryClient.invalidateQueries({ queryKey: ["fuel-consumption-stats"] });
      toast(t("fuel.updateSuccess"));
      setEditing(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t("fuel.updateError"), "error");
    },
  });

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post("/fuel-consumption", payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fuel-consumption"] });
      queryClient.invalidateQueries({ queryKey: ["fuel-consumption-stats"] });
      toast(t("fuel.addSuccess"));
      setCreating(false);
      setPage(1);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t("fuel.addError"), "error");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/fuel-consumption/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fuel-consumption"] });
      queryClient.invalidateQueries({ queryKey: ["fuel-consumption-stats"] });
      toast(t("fuel.deleteSuccess"));
      setDeleting(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t("fuel.deleteError"), "error");
      setDeleting(null);
    },
  });

  const saveDefaultsMutation = useMutation({
    mutationFn: (payload: Record<string, number>) =>
      api.put("/fuel-consumption/prices/defaults", payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fuel-prices"] });
      toast(t("fuel.defaultsSaved"));
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t("fuel.defaultsError"), "error");
    },
  });

  const createPriceMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post("/fuel-consumption/prices", payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fuel-prices"] });
      toast(t("fuel.priceSaved"));
      setAddingPrice(false);
      setEditingPrice(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t("fuel.priceError"), "error");
    },
  });

  const updatePriceMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Record<string, unknown>;
    }) =>
      api.patch(`/fuel-consumption/prices/${id}`, payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fuel-prices"] });
      toast(t("fuel.priceUpdated"));
      setAddingPrice(false);
      setEditingPrice(null);
    },
    onError: (err: ApiError) => {
      toast(err?.response?.data?.message || t("fuel.priceError"), "error");
    },
  });

  const deletePriceMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/fuel-consumption/prices/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fuel-prices"] });
      toast(t("fuel.priceDeleted"));
      setDeletingPrice(null);
    },
    onError: (err: ApiError) => {
      toast(
        err?.response?.data?.message || t("fuel.priceDeleteError"),
        "error",
      );
      setDeletingPrice(null);
    },
  });

  const openEdit = (l: FuelLog) => {
    setEditing(l);
    setCreating(false);
    setForm({
      vehicleId: l.vehicleId ?? l.vehicle?.id ?? "",
      liters: String(l.liters),
      kilometers: String(l.kilometers),
      cost: String(l.cost),
      fillDate: l.fillDate.slice(0, 10),
      notes: l.notes ?? "",
    });
  };

  const openCreate = () => {
    setCreating(true);
    setEditing(null);
    setForm({
      vehicleId: vehicles && vehicles.length > 0 ? vehicles[0].id : "",
      liters: "",
      kilometers: "",
      cost: "",
      fillDate: new Date().toISOString().slice(0, 10),
      notes: "",
    });
  };

  const closeDialog = () => {
    setEditing(null);
    setCreating(false);
  };

  const saveEdit = () => {
    if (!editing) return;
    const payload: Record<string, unknown> = {
      liters: Number(form.liters),
      kilometers: Number(form.kilometers),
      cost: Number(form.cost),
      fillDate: new Date(form.fillDate).toISOString(),
      vehicleId: form.vehicleId,
    };
    if (form.notes.trim()) payload.notes = form.notes.trim();
    updateMutation.mutate({ id: editing.id, payload });
  };

  const saveCreate = () => {
    if (
      !form.vehicleId ||
      !form.liters ||
      !form.kilometers ||
      !form.cost ||
      !form.fillDate
    ) {
      toast(t("fuel.requiredFields"), "error");
      return;
    }
    const payload: Record<string, unknown> = {
      liters: Number(form.liters),
      kilometers: Number(form.kilometers),
      cost: Number(form.cost),
      fillDate: new Date(form.fillDate).toISOString(),
      vehicleId: form.vehicleId,
    };
    if (form.notes.trim()) payload.notes = form.notes.trim();
    createMutation.mutate(payload);
  };

  const saveDefaults = () => {
    const payload: Record<string, number> = {};
    for (const ft of FUEL_TYPES) {
      const num = Number(defaultsDraft[ft]);
      if (Number.isFinite(num) && num >= 0) payload[ft] = num;
    }
    if (Object.keys(payload).length === 0) {
      toast(t("fuel.invalidPrice"), "error");
      return;
    }
    saveDefaultsMutation.mutate(payload);
  };

  const openAddPrice = () => {
    setEditingPrice(null);
    setAddingPrice(true);
    setPriceForm({
      fuelType: "diesel",
      pricePerLiter: "",
      effectiveFrom: new Date().toISOString().slice(0, 10),
      effectiveUntil: "",
    });
  };

  const openEditPrice = (p: FuelPrice) => {
    setAddingPrice(false);
    setEditingPrice(p);
    setPriceForm({
      fuelType: p.fuelType,
      pricePerLiter: String(p.pricePerLiter),
      effectiveFrom: p.effectiveFrom.slice(0, 10),
      effectiveUntil: p.effectiveUntil ? p.effectiveUntil.slice(0, 10) : "",
    });
  };

  const closePriceDialog = () => {
    setAddingPrice(false);
    setEditingPrice(null);
  };

  const savePrice = () => {
    const price = Number(priceForm.pricePerLiter);
    if (
      !priceForm.fuelType ||
      !Number.isFinite(price) ||
      price < 0 ||
      !priceForm.effectiveFrom
    ) {
      toast(t("fuel.invalidPrice"), "error");
      return;
    }
    const payload: Record<string, unknown> = {
      fuelType: priceForm.fuelType,
      pricePerLiter: price,
      effectiveFrom: priceForm.effectiveFrom,
    };
    if (priceForm.effectiveUntil)
      payload.effectiveUntil = priceForm.effectiveUntil;
    if (editingPrice) {
      updatePriceMutation.mutate({ id: editingPrice.id, payload });
    } else {
      createPriceMutation.mutate(payload);
    }
  };

  const entries: FuelLog[] = data?.data ?? [];
  const meta = data?.meta ?? { total: 0, page: 1, limit, totalPages: 1 };
  interface FuelReport {
    id: string | number;
    driverName?: string;
    vehiclePlate?: string;
    distanceKm?: number;
    gpsDataQuality?: "sufficient" | "insufficient";
    consumptionLPer100Km?: number;
    estimatedCost?: number;
    reportDate?: string;
  }
  const reportList: FuelReport[] = reports ?? [];
  const priceHistory: FuelPrice[] = pricesData?.history ?? [];
  const s: Partial<ConsumptionStats> = stats ?? {};

  const tabButtons = [
    {
      key: "manual" as const,
      label: t("fuel.tabManual"),
      icon: <PenLine size={15} />,
    },
    { key: "gps" as const, label: t("fuel.tabGps"), icon: <Radar size={15} /> },
    {
      key: "prices" as const,
      label: t("fuel.tabPrices"),
      icon: <CircleDollarSign size={15} />,
    },
  ];

  if (isLoading || reportsLoading || pricesLoading) {
    return (
      <div className={styles.pageContainer}>
        <div className={styles.pageHeader}>
          <div className={`${styles.shimmer} ${styles.shimmerChip}`} />
          <div className={styles.headerText}>
            <div className={`${styles.shimmer} ${styles.shimmerKicker}`} />
            <div className={`${styles.shimmer} ${styles.shimmerTitle}`} />
          </div>
          <div className={`${styles.shimmer} ${styles.shimmerBadge}`} />
        </div>
        <div className={`${styles.shimmer} ${styles.shimmerTabs}`} />
        <div className={styles.kpiGrid}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={styles.kpiSkeleton}>
              <div
                className={`${styles.shimmer} ${styles.shimmerIcon}`}
                style={{ animationDelay: `${i * 60}ms` }}
              />
              <div
                className={`${styles.shimmer} ${styles.shimmerValue}`}
                style={{ animationDelay: `${i * 60 + 40}ms` }}
              />
            </div>
          ))}
        </div>
        <div className={styles.tableSkeleton}>
          <div className={`${styles.shimmer} ${styles.shimmerTableHeader}`} />
          {[0, 1, 2, 3, 4].map((r) => (
            <div key={r} className={styles.skeletonRowLine}>
              {[24, 12, 12, 16, 14, 18, 16, 10].map((w, c) => (
                <div
                  key={c}
                  className={`${styles.shimmer} ${styles.shimmerCell}`}
                  style={{
                    width: `${w}%`,
                    animationDelay: `${(r + c) * 50}ms`,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.pageContainer}>
        <div className={styles.pageHeader}>
          <div className={styles.titleIconChip}>
            <Fuel size={22} />
          </div>
          <div className={styles.headerText}>
            <h1 className={styles.pageTitle}>{t("fuel.title")}</h1>
          </div>
        </div>
        <p className={styles.errorText}>{t("fuel.error")}</p>
      </div>
    );
  }

  return (
    <div className={styles.pageContainer}>
      <div className={styles.pageHeader}>
        <div className={styles.titleIconChip}>
          <Fuel size={22} />
        </div>
        <div className={styles.headerText}>
          <span className={styles.kicker}>{t("fuel.kicker")}</span>
          <h1 className={styles.pageTitle}>{t("fuel.title")}</h1>
          <p className={styles.pageSubtitle}>{t("fuel.subtitle")}</p>
        </div>

        <div className={styles.headerChips}>
          <span className={styles.headerChip}>
            <Droplets size={13} />
            {(s.logCount ?? 0).toLocaleString("fr-FR")} {t("fuel.stats.logs")}
          </span>
          {(s.anomalyCount ?? 0) > 0 && (
            <span className={`${styles.headerChip} ${styles.headerChipDanger}`}>
              <AlertTriangle size={13} />
              {(s.anomalyCount ?? 0).toLocaleString("fr-FR")}{" "}
              {t("fuel.stats.anomalies").toLowerCase()}
            </span>
          )}
        </div>
      </div>

      <div className={styles.tabsRow}>
        {tabButtons.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`${styles.tabBtn} ${tab === b.key ? styles.tabBtnActive : styles.tabBtnInactive}`}
            onClick={() => setTab(b.key)}
          >
            {b.icon}
            {b.label}
          </button>
        ))}
      </div>

      {/* Saisie manuelle */}
      {tab === "manual" && (
        <>
          <div className={styles.toolbarRow}>
            <div className={styles.kpiGrid}>
              <KpiCard
                icon={<Droplets size={16} />}
                label={t("fuel.stats.totalLiters")}
                value={Math.round(s.totalLiters ?? 0)}
                unit={t("fuel.unitLiters")}
                color="var(--color-teal)"
                delay={0}
              />
              <KpiCard
                icon={<Gauge size={16} />}
                label={t("fuel.stats.totalKm")}
                value={Math.round(s.totalKilometers ?? 0)}
                unit={t("fuel.unitKm")}
                color="var(--color-accent)"
                delay={60}
              />
              <KpiCard
                icon={<Wallet size={16} />}
                label={t("fuel.stats.totalCost")}
                value={s.totalCost ?? 0}
                format={formatAriary}
                color="var(--color-blue)"
                delay={120}
              />
              <KpiCard
                icon={<Fuel size={16} />}
                label={t("fuel.stats.avgConsumption")}
                value={s.averageConsumption ?? 0}
                unit={t("fuel.unitPer100")}
                color="var(--color-purple)"
                decimals={1}
                delay={180}
              />
              <KpiCard
                icon={<AlertTriangle size={16} />}
                label={t("fuel.stats.anomalies")}
                value={s.anomalyCount ?? 0}
                color="var(--color-red)"
                delay={240}
                pulse={(s.anomalyCount ?? 0) > 0}
              />
            </div>

            <button
              type="button"
              className={styles.addBtn}
              onClick={openCreate}
            >
              <Plus size={16} /> {t("fuel.addEntry")}
            </button>
          </div>

          {entries.length === 0 && (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>
                <Inbox size={24} />
              </span>
              <p className={styles.emptyTitle}>{t("fuel.emptyTitle")}</p>
              <p className={styles.emptyText}>{t("fuel.empty")}</p>
            </div>
          )}

          {entries.length > 0 && (
            <>
              <div className={styles.tableCard}>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr className={styles.tableHeadRow}>
                        <th className={styles.tableHeadCell}>
                          {t("fuel.table.vehicle")}
                        </th>
                        <th className={styles.tableHeadCell}>
                          {t("fuel.table.liters")}
                        </th>
                        <th className={styles.tableHeadCell}>
                          {t("fuel.table.kmHeader")}
                        </th>
                        <th className={styles.tableHeadCell}>
                          {t("fuel.table.consumption")}
                        </th>
                        <th className={styles.tableHeadCellRight}>
                          {t("fuel.table.cost")}
                        </th>
                        <th className={styles.tableHeadCell}>
                          {t("fuel.table.date")}
                        </th>
                        <th className={styles.tableHeadCell}>
                          {t("fuel.table.anomaly")}
                        </th>
                        <th className={styles.tableHeadCellRight}>
                          {t("common.actions")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((l) => (
                        <tr key={l.id} className={styles.tableRow}>
                          <td className={styles.tableCell}>
                            <span className={styles.fuelVehicle}>
                              <span className={styles.fuelVehicleIcon}>
                                <Car size={14} />
                              </span>
                              <span className={styles.fuelVehiclePlate}>
                                {l.vehicle?.licensePlate ?? "-"}
                              </span>
                            </span>
                          </td>
                          <td className={styles.tableCell}>
                            <span className={styles.monoValue}>{l.liters}</span>
                            <span className={styles.monoUnit}>L</span>
                          </td>
                          <td className={styles.tableCell}>
                            <span className={styles.monoValue}>
                              {l.kilometers}
                            </span>
                            <span className={styles.monoUnit}>km</span>
                          </td>
                          <td className={styles.tableCell}>
                            <span className={styles.consPill}>
                              {l.calculatedConsumption?.toFixed(1) ?? "-"}
                              <span className={styles.consUnit}>L/100km</span>
                            </span>
                          </td>
                          <td
                            className={`${styles.tableCell} ${styles.tableCellRight}`}
                          >
                            <span className={styles.costCell}>
                              {l.cost.toFixed(2)} €
                            </span>
                          </td>
                          <td className={styles.tableCell}>
                            <span className={styles.dateCell}>
                              <Calendar size={13} />
                              {new Date(l.fillDate).toLocaleDateString(
                                i18n.language,
                              )}
                            </span>
                          </td>
                          <td className={styles.tableCell}>
                            {l.anomalyFlag ? (
                              <span
                                className={`${styles.badge} ${styles.badgeAnomaly}`}
                                title={
                                  l.consumptionDeviationDirection
                                    ? l.consumptionDeviationDirection === "over"
                                      ? t("fuel.overConsumption")
                                      : t("fuel.underConsumption")
                                    : undefined
                                }
                              >
                                {l.consumptionDeviationDirection === "over" ? (
                                  <ArrowUpRight size={12} />
                                ) : l.consumptionDeviationDirection ===
                                  "under" ? (
                                  <ArrowDownRight size={12} />
                                ) : (
                                  <AlertTriangle size={12} />
                                )}
                                {t("fuel.anomaly")}
                              </span>
                            ) : l.gpsCoverageInsufficientFlag ? (
                              // Signal « non vérifiable » : couverture GPS absente sur la
                              // période (gpsCoverageInsufficientFlag), affiché en neutre
                              // (gris), distinct du rouge des anomalies confirmées.
                              <span
                                className={`${styles.badge} ${styles.badgeMuted}`}
                                title={
                                  l.gpsCoverageInsufficientReason ?? undefined
                                }
                              >
                                <HelpCircle size={12} />{" "}
                                {t("fuel.nonVerifiable")}
                              </span>
                            ) : (
                              <span
                                className={`${styles.badge} ${styles.badgeNormal}`}
                              >
                                <CheckCircle2 size={12} /> {t("fuel.normal")}
                              </span>
                            )}
                          </td>
                          <td
                            className={`${styles.tableCell} ${styles.tableCellRight}`}
                          >
                            <div className={styles.actionsRow}>
                              <button
                                type="button"
                                className={styles.actionBtn}
                                onClick={() => openEdit(l)}
                                title={t("common.edit")}
                                aria-label={t("common.edit")}
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                className={`${styles.actionBtn} ${styles.danger}`}
                                onClick={() => setDeleting(l)}
                                title={t("common.delete")}
                                aria-label={t("common.delete")}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {meta.totalPages > 1 && (
                <div className={styles.pagination}>
                  <button
                    type="button"
                    className={styles.pageBtn}
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    ←
                  </button>
                  {Array.from({ length: meta.totalPages }, (_, i) => i + 1).map(
                    (p) => (
                      <button
                        key={p}
                        type="button"
                        className={`${styles.pageBtn} ${p === page ? styles.pageBtnActive : ""}`}
                        onClick={() => setPage(p)}
                      >
                        {p}
                      </button>
                    ),
                  )}
                  <button
                    type="button"
                    className={styles.pageBtn}
                    disabled={page >= meta.totalPages}
                    onClick={() => setPage(page + 1)}
                  >
                    →
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Rapport GPS */}
      {tab === "gps" && (
        <div>
          <p className={styles.helpText}>
            <Radar size={14} className={styles.helpInlineIcon} />{" "}
            {t("fuel.gpsHelp")}
          </p>

          <div className={styles.controlCard}>
            <div className={styles.controlIcon}>
              <Radar size={18} />
            </div>
            <div className={styles.controlField}>
              <label className={styles.label}>{t("fuel.date")}</label>
              <input
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
                className={styles.dateInput}
              />
            </div>
            <button
              type="button"
              className={styles.genBtn}
              onClick={() => generateMutation.mutate(reportDate)}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? (
                <RefreshCw
                  size={15}
                  style={{ animation: "dt-spin 0.6s linear infinite" }}
                />
              ) : (
                <CalendarDays size={15} />
              )}
              {generateMutation.isPending
                ? t("fuel.generating")
                : t("fuel.generateReport")}
            </button>
          </div>

          {generateMutation.isSuccess && (
            <p className={styles.successText}>
              <CheckCircle2 size={14} /> {t("fuel.generateSuccess")}
            </p>
          )}

          {generateMutation.isError && (
            <p className={styles.errorTextMsg}>{t("fuel.generateError")}</p>
          )}

          {reportList.length === 0 && (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>
                <Radar size={24} />
              </span>
              <p className={styles.emptyTitle}>{t("fuel.tabGps")}</p>
              <p className={styles.emptyText}>{t("fuel.gpsEmpty")}</p>
            </div>
          )}

          {reportList.length > 0 && (
            <div className={styles.tableCard}>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr className={styles.tableHeadRow}>
                      <th className={styles.tableHeadCell}>
                        {t("fuel.table.driver")}
                      </th>
                      <th className={styles.tableHeadCell}>
                        {t("fuel.table.vehicle")}
                      </th>
                      <th className={styles.tableHeadCell}>
                        {t("fuel.gpsDistance")}
                      </th>
                      <th className={styles.tableHeadCell}>
                        {t("fuel.table.consumption")}
                      </th>
                      <th className={styles.tableHeadCellRight}>
                        {t("fuel.estimatedCost")}
                      </th>
                      <th className={styles.tableHeadCell}>
                        {t("fuel.table.date")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportList.map((r: FuelReport, i: number) => (
                      <tr key={r.id || i} className={styles.tableRow}>
                        <td className={styles.tableCell}>
                          <span className={styles.driverCell}>
                            <span className={styles.driverAvatar}>
                              {initials(r.driverName)}
                            </span>
                            <span className={styles.driverName}>
                              {r.driverName || "—"}
                            </span>
                          </span>
                        </td>
                        <td className={styles.tableCell}>
                          <span className={styles.plateChip}>
                            <Car size={12} /> {r.vehiclePlate || "—"}
                          </span>
                        </td>
                        <td className={styles.tableCell}>
                          <div className={styles.distCell}>
                            <span className={styles.monoValue}>
                              {r.distanceKm?.toFixed(1)} km
                            </span>
                            {r.gpsDataQuality === "insufficient" && (
                              // gpsDataQuality='insufficient' : des positions GPS existent mais la
                              // distance calculée est trop faible pour être fiable (< 0.1 km) — ce
                              // n'est PAS une anomalie confirmée, juste une donnée peu fiable ce
                              // jour-là. Badge neutre (orange clair), distinct de
                              // gpsCoverageInsufficientFlag (aucune position du tout) et du rouge
                              // des anomalies.
                              <span
                                className={`${styles.badge} ${styles.badgeWarn}`}
                                title={t("fuel.gpsQualityInsufficient")}
                              >
                                <HelpCircle size={12} />{" "}
                                {t("fuel.gpsQualityBadge")}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={styles.tableCell}>
                          <span className={styles.consPill}>
                            {r.consumptionLPer100Km?.toFixed(1) ?? "-"}
                            <span className={styles.consUnit}>L/100km</span>
                          </span>
                        </td>
                        <td
                          className={`${styles.tableCell} ${styles.tableCellRight}`}
                        >
                          <span className={styles.costCellAr}>
                            {formatAriary(r.estimatedCost)}
                          </span>
                        </td>
                        <td className={styles.tableCell}>
                          <span className={styles.dateCell}>
                            <Calendar size={13} />
                            {r.reportDate
                              ? new Date(r.reportDate).toLocaleDateString(
                                  i18n.language,
                                )
                              : "-"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className={styles.diagCard}>
            <div className={styles.diagHeader}>
              <div className={styles.diagTitleWrap}>
                <div className={styles.diagTitleRow}>
                  <Activity size={15} className={styles.diagTitleIcon} />
                  <h3 className={styles.diagTitle}>{t("fuel.gpsDiagTitle")}</h3>
                </div>
                <p className={styles.helpText}>{t("fuel.gpsDiagHelp")}</p>
              </div>
              <button
                type="button"
                className={styles.genBtn}
                onClick={() => setDiagOpen((o) => !o)}
                aria-expanded={diagOpen}
              >
                {diagOpen ? <EyeOff size={15} /> : <Activity size={15} />}
                {diagOpen ? t("fuel.gpsDiagHide") : t("fuel.gpsDiagShow")}
              </button>
            </div>

            {diagOpen && diagnosticsFetching && !diagnostics && (
              <p className={styles.helpText}>{t("fuel.gpsDiagLoading")}</p>
            )}

            {diagOpen && diagnosticsError && (
              <p className={styles.errorText}>{t("fuel.gpsDiagError")}</p>
            )}

            {diagOpen && diagnostics && (
              <>
                <p className={styles.helpText}>
                  {t("fuel.gpsDiagTotal", {
                    count: diagnostics.totalPositions,
                  })}
                  {diagnostics.unattributedPositions > 0 &&
                    ` — ${t("fuel.gpsDiagUnattributed", { count: diagnostics.unattributedPositions })}`}
                </p>

                {diagnostics.vehicles.some((v) => v.longGapCount > 0) && (
                  <div className={styles.diagWarn}>
                    <AlertTriangle size={14} /> {t("fuel.gpsDiagSparse")}
                  </div>
                )}

                {diagnostics.vehicles.some(
                  (v) => v.validCount >= 2 && v.speedReportedCount === 0,
                ) && (
                  <div className={styles.diagWarn}>
                    <Info size={14} /> {t("fuel.gpsDiagNoSpeed")}
                  </div>
                )}

                {diagnostics.vehicles.length === 0 ? (
                  <p className={styles.emptyText}>{t("fuel.gpsDiagEmpty")}</p>
                ) : (
                  <div className={styles.tableWrap}>
                    <table className={styles.table}>
                      <thead>
                        <tr className={styles.tableHeadRow}>
                          <th className={styles.tableHeadCell}>
                            {t("fuel.gpsDiagColVehicle")}
                          </th>
                          <th className={styles.tableHeadCell}>
                            {t("fuel.gpsDiagColDriver")}
                          </th>
                          <th className={styles.tableHeadCell}>
                            {t("fuel.gpsDiagColFixes")}
                          </th>
                          <th className={styles.tableHeadCell}>
                            {t("fuel.gpsDiagColSuspect")}
                          </th>
                          <th className={styles.tableHeadCell}>
                            {t("fuel.gpsDiagColCoverage")}
                          </th>
                          <th className={styles.tableHeadCell}>
                            {t("fuel.gpsDiagColGap")}
                          </th>
                          <th className={styles.tableHeadCell}>
                            {t("fuel.gpsDiagColDist")}
                          </th>
                          <th className={styles.tableHeadCell}>
                            {t("fuel.gpsDiagColReport")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {diagnostics.vehicles.map((v, i) => (
                          <tr
                            key={v.vehicleId || i}
                            className={styles.tableRow}
                          >
                            <td className={styles.tableCell}>
                              <span className={styles.plateChip}>
                                <Car size={12} /> {v.vehiclePlate}
                              </span>
                            </td>
                            <td className={styles.tableCell}>
                              {v.driverName || "—"}
                            </td>
                            <td className={styles.tableCell}>
                              <span className={styles.monoValue}>
                                {v.validCount}/{v.fixCount}
                              </span>
                            </td>
                            <td className={styles.tableCell}>
                              {v.suspectCount > 0 ? v.suspectCount : "—"}
                            </td>
                            <td className={styles.tableCell}>
                              <span className={styles.monoValue}>
                                {v.coveragePercent}%
                              </span>
                            </td>
                            <td className={styles.tableCell}>
                              <span className={styles.monoValue}>
                                {gpsDur(v.avgGapSec)}
                              </span>
                              <span className={styles.diagSlash}>{" / "}</span>
                              <span className={styles.monoValue}>
                                {gpsDur(v.maxGapSec)}
                              </span>
                            </td>
                            <td className={styles.tableCell}>
                              <span className={styles.monoValue}>
                                {v.rawDistanceKm.toFixed(2)}
                              </span>
                              <span className={styles.diagSlash}>{" / "}</span>
                              <span className={styles.monoValue}>
                                {v.filteredDistanceKm.toFixed(2)}
                              </span>
                              {" km"}
                            </td>
                            <td className={styles.tableCell}>
                              <span className={styles.monoValue}>
                                {v.reportDistanceKm != null
                                  ? v.reportDistanceKm.toFixed(1)
                                  : "—"}
                              </span>
                              {" km"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>

          <div className={styles.helpBox}>
            <span className={styles.helpIcon}>
              <Info size={16} />
            </span>
            <span className={styles.helpBody}>
              <strong>{t("fuel.helpTitle")} :</strong>
              <br />
              {t("fuel.helpManual")}
              <br />
              {t("fuel.helpGps")}
            </span>
          </div>
        </div>
      )}

      {/* Prix carburant */}
      {tab === "prices" && (
        <div>
          <p className={styles.helpText}>
            <CircleDollarSign size={14} className={styles.helpInlineIcon} />{" "}
            {t("fuel.pricesHelp")}
          </p>

          <div className={styles.pricesSection}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionHeaderIcon}>
                <CircleDollarSign size={15} />
              </span>
              <h3 className={styles.pricesTitle}>
                {t("fuel.defaultPricesTitle")}
              </h3>
            </div>
            <p className={styles.helpText}>{t("fuel.defaultPricesHelp")}</p>
            <div className={styles.defaultsGrid}>
              {FUEL_TYPES.map((ft) => {
                const color = FUEL_TYPE_COLORS[ft] || "var(--color-accent)";
                return (
                  <div key={ft} className={styles.defaultsField}>
                    <label
                      className={styles.defaultsFieldLabel}
                      style={{ color }}
                    >
                      <span
                        className={styles.fuelTypeIconSm}
                        style={{
                          background: `color-mix(in srgb, ${color} 14%, transparent)`,
                          color,
                        }}
                      >
                        {FUEL_TYPE_ICONS[ft]}
                      </span>
                      {t(`fuel.types.${ft}`)}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      className={styles.dateInput}
                      value={defaultsDraft[ft] ?? ""}
                      onChange={(e) =>
                        setDefaultsDraft((d) => ({
                          ...d,
                          [ft]: e.target.value,
                        }))
                      }
                    />
                  </div>
                );
              })}
            </div>
            <div>
              <button
                type="button"
                className={styles.addBtn}
                onClick={saveDefaults}
                disabled={saveDefaultsMutation.isPending}
              >
                {saveDefaultsMutation.isPending ? "…" : t("fuel.saveDefaults")}
              </button>
            </div>
          </div>

          <div className={styles.pricesSection}>
            <div className={styles.historyHeader}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionHeaderIcon}>
                  <CircleDollarSign size={15} />
                </span>
                <h3 className={styles.pricesTitle}>{t("fuel.historyTitle")}</h3>
              </div>
              <button
                type="button"
                className={styles.addBtn}
                onClick={openAddPrice}
              >
                <Plus size={16} /> {t("fuel.addPrice")}
              </button>
            </div>
            <p className={styles.helpText}>{t("fuel.historyHelp")}</p>

            {priceHistory.length === 0 && (
              <div className={styles.emptyState}>
                <span className={styles.emptyIcon}>
                  <CircleDollarSign size={24} />
                </span>
                <p className={styles.emptyTitle}>{t("fuel.historyTitle")}</p>
                <p className={styles.emptyText}>{t("fuel.noPrices")}</p>
              </div>
            )}

            {priceHistory.length > 0 && (
              <div className={styles.tableCard}>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr className={styles.tableHeadRow}>
                        <th className={styles.tableHeadCell}>
                          {t("fuel.fuelType")}
                        </th>
                        <th className={styles.tableHeadCellRight}>
                          {t("fuel.pricePerLiter")}
                        </th>
                        <th className={styles.tableHeadCell}>
                          {t("fuel.effectiveFrom")}
                        </th>
                        <th className={styles.tableHeadCell}>
                          {t("fuel.effectiveUntil")}
                        </th>
                        <th className={styles.tableHeadCellRight}>
                          {t("common.actions")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {priceHistory.map((p) => {
                        const color =
                          FUEL_TYPE_COLORS[p.fuelType] || "var(--color-accent)";
                        return (
                          <tr key={p.id} className={styles.tableRow}>
                            <td className={styles.tableCell}>
                              <span className={styles.fuelTypeCell}>
                                <span
                                  className={styles.fuelTypeIcon}
                                  style={{
                                    background: `color-mix(in srgb, ${color} 14%, transparent)`,
                                    color,
                                  }}
                                >
                                  {FUEL_TYPE_ICONS[p.fuelType]}
                                </span>
                                <span className={styles.fuelTypeName}>
                                  {t(`fuel.types.${p.fuelType}`, {
                                    defaultValue: p.fuelType,
                                  })}
                                </span>
                              </span>
                            </td>
                            <td
                              className={`${styles.tableCell} ${styles.tableCellRight}`}
                            >
                              <span className={styles.costCellAr}>
                                {formatAriary(p.pricePerLiter)}
                              </span>
                            </td>
                            <td className={styles.tableCell}>
                              <span className={styles.dateCell}>
                                <Calendar size={13} />
                                {new Date(p.effectiveFrom).toLocaleDateString(
                                  i18n.language,
                                )}
                              </span>
                            </td>
                            <td className={styles.tableCell}>
                              {p.effectiveUntil ? (
                                <span className={styles.dateCell}>
                                  <Calendar size={13} />
                                  {new Date(
                                    p.effectiveUntil,
                                  ).toLocaleDateString(i18n.language)}
                                </span>
                              ) : (
                                <span className={styles.openPill}>∞</span>
                              )}
                            </td>
                            <td
                              className={`${styles.tableCell} ${styles.tableCellRight}`}
                            >
                              <div className={styles.actionsRow}>
                                <button
                                  type="button"
                                  className={styles.actionBtn}
                                  onClick={() => openEditPrice(p)}
                                  title={t("common.edit")}
                                  aria-label={t("common.edit")}
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  type="button"
                                  className={`${styles.actionBtn} ${styles.danger}`}
                                  onClick={() => setDeletingPrice(p)}
                                  title={t("common.delete")}
                                  aria-label={t("common.delete")}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <EntityDialog
        open={!!editing || creating}
        onClose={closeDialog}
        title={editing ? t("fuel.editTitle") : t("fuel.addTitle")}
        footer={
          <DialogSubmitBar
            loading={updateMutation.isPending || createMutation.isPending}
            onCancel={closeDialog}
            submitLabel={editing ? t("common.save") : t("fuel.addSubmit")}
            form={editing ? "fuel-edit-form" : "fuel-create-form"}
          />
        }
      >
        <form
          id={editing ? "fuel-edit-form" : "fuel-create-form"}
          onSubmit={(e) => {
            e.preventDefault();
            editing ? saveEdit() : saveCreate();
          }}
        >
          <DialogSection title={t("fuel.editDetails")}>
            <DialogField label={t("fuel.table.vehicle")} required>
              <select
                className="dialog-select"
                value={form.vehicleId}
                onChange={(e) =>
                  setForm({ ...form, vehicleId: e.target.value })
                }
              >
                {(vehicles ?? []).map((v: Vehicle) => (
                  <option key={v.id} value={v.id}>
                    {v.brand} {v.model} ({v.licensePlate})
                  </option>
                ))}
              </select>
            </DialogField>
            <DialogField label={t("fuel.table.liters")} required>
              <input
                className="dialog-input"
                type="number"
                step="any"
                min="0"
                value={form.liters}
                onChange={(e) => setForm({ ...form, liters: e.target.value })}
              />
            </DialogField>
            <DialogField
              label={t("fuel.table.km")}
              hint={t("fuel.kmHelper")}
              required
            >
              <input
                className="dialog-input"
                type="number"
                step="any"
                min="0"
                value={form.kilometers}
                onChange={(e) =>
                  setForm({ ...form, kilometers: e.target.value })
                }
              />
            </DialogField>
            <DialogField label={t("fuel.table.cost")} required>
              <input
                className="dialog-input"
                type="number"
                step="any"
                min="0"
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: e.target.value })}
              />
            </DialogField>
            <DialogField label={t("fuel.date")} required>
              <input
                className="dialog-input"
                type="date"
                value={form.fillDate}
                onChange={(e) => setForm({ ...form, fillDate: e.target.value })}
              />
            </DialogField>
            <DialogField label={t("fuel.notes")}>
              <input
                className="dialog-input"
                type="text"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </DialogField>
          </DialogSection>
        </form>
      </EntityDialog>

      <EntityDialog
        open={addingPrice || !!editingPrice}
        onClose={closePriceDialog}
        title={
          editingPrice ? t("fuel.editPriceTitle") : t("fuel.addPriceTitle")
        }
        footer={
          <DialogSubmitBar
            loading={
              createPriceMutation.isPending || updatePriceMutation.isPending
            }
            onCancel={closePriceDialog}
            submitLabel={editingPrice ? t("common.save") : t("fuel.addPrice")}
            form="fuel-price-form"
          />
        }
      >
        <form
          id="fuel-price-form"
          onSubmit={(e) => {
            e.preventDefault();
            savePrice();
          }}
        >
          <DialogSection
            title={
              editingPrice ? t("fuel.editPriceTitle") : t("fuel.addPriceTitle")
            }
          >
            <DialogField label={t("fuel.fuelType")} required>
              <select
                className="dialog-select"
                value={priceForm.fuelType}
                onChange={(e) =>
                  setPriceForm({ ...priceForm, fuelType: e.target.value })
                }
              >
                {FUEL_TYPES.map((ft) => (
                  <option key={ft} value={ft}>
                    {t(`fuel.types.${ft}`)}
                  </option>
                ))}
              </select>
            </DialogField>
            <DialogField label={t("fuel.pricePerLiter")} required>
              <input
                className="dialog-input"
                type="number"
                min="0"
                step="any"
                value={priceForm.pricePerLiter}
                onChange={(e) =>
                  setPriceForm({ ...priceForm, pricePerLiter: e.target.value })
                }
              />
            </DialogField>
            <DialogField label={t("fuel.effectiveFrom")} required>
              <input
                className="dialog-input"
                type="date"
                value={priceForm.effectiveFrom}
                onChange={(e) =>
                  setPriceForm({ ...priceForm, effectiveFrom: e.target.value })
                }
              />
            </DialogField>
            <DialogField label={t("fuel.effectiveUntil")}>
              <input
                className="dialog-input"
                type="date"
                value={priceForm.effectiveUntil}
                onChange={(e) =>
                  setPriceForm({ ...priceForm, effectiveUntil: e.target.value })
                }
              />
            </DialogField>
          </DialogSection>
        </form>
      </EntityDialog>

      <ConfirmDialog
        open={!!deletingPrice}
        title={t("fuel.confirmDeletePriceTitle")}
        message={
          deletingPrice
            ? `${t("fuel.fuelType")} : ${t(`fuel.types.${deletingPrice.fuelType}`, { defaultValue: deletingPrice.fuelType })} — ${formatAriary(deletingPrice.pricePerLiter)}`
            : ""
        }
        variant="danger"
        confirmLabel={t("common.delete")}
        onConfirm={() =>
          deletingPrice && deletePriceMutation.mutate(deletingPrice.id)
        }
        onCancel={() => setDeletingPrice(null)}
      />

      <ConfirmDialog
        open={!!deleting}
        title={t("fuel.confirmDeleteTitle")}
        message={
          deleting
            ? `${t("fuel.confirmDeleteMessage")} (${deleting.vehicle?.licensePlate ?? deleting.vehicleId}, ${new Date(deleting.fillDate).toLocaleDateString(i18n.language)})`
            : ""
        }
        variant="danger"
        confirmLabel={t("common.delete")}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
