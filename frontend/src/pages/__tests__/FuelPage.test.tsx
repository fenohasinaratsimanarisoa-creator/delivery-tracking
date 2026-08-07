import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FuelPage from "../FuelPage";

const { mockApiGet, mockApiPost, mockApiPatch, mockApiDelete } = vi.hoisted(
  () => ({
    mockApiGet: vi.fn(),
    mockApiPost: vi.fn(),
    mockApiPatch: vi.fn(),
    mockApiDelete: vi.fn(),
  }),
);

vi.mock("../../services/api/client", () => ({
  default: {
    get: mockApiGet,
    post: mockApiPost,
    patch: mockApiPatch,
    delete: mockApiDelete,
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));
vi.mock("../../components/Toast", () => ({
  useToast: vi.fn(() => ({ toast: vi.fn() })),
}));

const mockUseQuery = vi.hoisted(() => vi.fn());
const mockUseMutation = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-query", () => ({
  useQuery: mockUseQuery,
  useMutation: mockUseMutation,
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
}));

describe("FuelPage", () => {
  const mockEntries = [
    {
      id: "fuel-1",
      vehicleId: "veh-1",
      vehicle: { id: "veh-1", licensePlate: "AB-123-CD" },
      liters: 50,
      kilometers: 400,
      cost: 245000,
      fillDate: "2026-07-20T10:00:00.000Z",
      notes: null,
      anomalyFlag: false,
      calculatedConsumption: null,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === "fuel-daily-reports") {
        return { data: [], isLoading: false };
      }
      if (queryKey[0] === "fuel-prices") {
        return {
          data: { defaults: { diesel: 5200 }, history: [] },
          isLoading: false,
        };
      }
      if (queryKey[0] === "vehicles") {
        return {
          data: [
            {
              id: "veh-1",
              brand: "Toyota",
              model: "Hilux",
              licensePlate: "AB-123-CD",
            },
          ],
          isLoading: false,
        };
      }
      return {
        data: {
          data: mockEntries,
          meta: { total: 1, page: 1, limit: 20, totalPages: 1 },
        },
        isLoading: false,
      };
    });
    mockUseMutation.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isSuccess: false,
      isError: false,
    });
  });

  it("renders the manual entry table and the new fuel log button", async () => {
    render(<FuelPage />);

    expect(screen.getByText("AB-123-CD")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Nouveau plein" }),
    ).toBeInTheDocument();
  });

  it('opens the create dialog when clicking "Nouveau plein"', async () => {
    render(<FuelPage />);

    fireEvent.click(screen.getByRole("button", { name: "Nouveau plein" }));

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Ajouter un relevé" }),
      ).toBeInTheDocument();
    });
  });

  it('shows the explicit distance label and the "odometer" helper in the create dialog', async () => {
    render(<FuelPage />);

    fireEvent.click(screen.getByRole("button", { name: "Nouveau plein" }));

    await waitFor(() => {
      expect(
        screen.getByRole("dialog", { name: "Ajouter un relevé" }),
      ).toBeInTheDocument();
    });

    // Label explicite du champ kilométrage : distance depuis le dernier plein.
    const label = screen.getByText(/Distance depuis le dernier plein \(km\)/);
    const hint = screen.getByText("Ne pas saisir le kilométrage au compteur");
    console.log(`[dialog] label = "${label.textContent}"`);
    console.log(`[dialog] hint  = "${hint.textContent}"`);

    expect(label).toBeInTheDocument();
    expect(hint).toBeInTheDocument();
  });

  it("renders the fuel prices tab with editable default prices", async () => {
    render(<FuelPage />);

    fireEvent.click(screen.getByRole("button", { name: "Prix carburant" }));

    await waitFor(() => {
      expect(
        screen.getByText("Prix par défaut (par type de carburant)"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("Enregistrer les prix par défaut"),
    ).toBeInTheDocument();
    expect(screen.getByText("Diesel")).toBeInTheDocument();
  });

  it('affiche un badge neutre quand gpsDataQuality === "insufficient" sur un rapport GPS (Distance GPS peu fiable)', async () => {
    // Un rapport GPS dont la distance calculée est jugée insuffisante (< 0.1 km) :
    // des positions GPS existent, mais le badge doit être distinct de
    // gpsCoverageInsufficientFlag (absence totale de positions) et rester neutre (non rouge).
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === "fuel-daily-reports") {
        return {
          data: [
            {
              id: 1,
              driverName: "Jean Rakoto",
              vehiclePlate: "TRK-1",
              distanceKm: 0,
              gpsDataQuality: "insufficient",
              consumptionLPer100Km: 0,
              estimatedCost: 0,
              reportDate: "2026-07-20T00:00:00.000Z",
            },
          ],
          isLoading: false,
        };
      }
      if (queryKey[0] === "fuel-prices") {
        return {
          data: { defaults: { diesel: 5200 }, history: [] },
          isLoading: false,
        };
      }
      if (queryKey[0] === "vehicles") {
        return {
          data: [
            {
              id: "veh-1",
              brand: "Toyota",
              model: "Hilux",
              licensePlate: "AB-123-CD",
            },
          ],
          isLoading: false,
        };
      }
      return {
        data: {
          data: [],
          meta: { total: 0, page: 1, limit: 20, totalPages: 1 },
        },
        isLoading: false,
      };
    });

    render(<FuelPage />);

    fireEvent.click(screen.getByRole("button", { name: "Rapport GPS" }));

    await waitFor(() => {
      expect(screen.getByText("GPS faible")).toBeInTheDocument();
    });

    // Preuve : le badge est bien rendu dans le HTML (sortie réelle).
    const html = document.body.innerHTML;
    console.log(
      '[FuelPage gpsDataQuality] badge "GPS faible" présent dans le HTML :',
      html.includes("GPS faible"),
    );
    // Le tooltip explicatif est présent via l'attribut title.
    const badge = screen.getByText("GPS faible");
    expect(badge.getAttribute("title")).toContain("Distance GPS trop faible");
    // Ce n'est PAS une anomalie (pas de texte "Anomalie" associé à ce rapport).
    expect(html).not.toContain("Anomalie");
  });

  it("affiche le diagnostic GPS brut par véhicule (fixes, couverture, brute vs filtrée)", async () => {
    mockUseQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey[0] === "fuel-daily-reports") {
        return { data: [], isLoading: false };
      }
      if (queryKey[0] === "fuel-prices") {
        return {
          data: { defaults: { diesel: 5200 }, history: [] },
          isLoading: false,
        };
      }
      if (queryKey[0] === "vehicles") {
        return { data: [], isLoading: false };
      }
      if (queryKey[0] === "gps-diagnostics") {
        return {
          data: {
            date: "2026-07-20",
            totalPositions: 8,
            unattributedPositions: 0,
            vehicles: [
              {
                vehicleId: "veh-1",
                vehiclePlate: "TRK-1",
                driverName: "Jean Rakoto",
                fixCount: 4,
                validCount: 3,
                suspectCount: 1,
                spanSec: 210,
                avgGapSec: 105,
                maxGapSec: 180,
                longGapCount: 1,
                coveragePercent: 25,
                rawDistanceKm: 0.33,
                filteredDistanceKm: 0.33,
                reportDistanceKm: 0.33,
                accuracyMin: 5,
                accuracyMax: 40,
                accuracyAvg: 5,
                speedMaxMs: 4.5,
                movingCount: 3,
                speedReportedCount: 3,
              },
              {
                vehicleId: "veh-2",
                vehiclePlate: "TRK-2",
                driverName: null,
                fixCount: 4,
                validCount: 4,
                suspectCount: 0,
                spanSec: 30,
                avgGapSec: 10,
                maxGapSec: 10,
                longGapCount: 0,
                coveragePercent: 0,
                rawDistanceKm: 0.01,
                filteredDistanceKm: 0,
                reportDistanceKm: 0,
                accuracyMin: 10,
                accuracyMax: 10,
                accuracyAvg: 10,
                speedMaxMs: null,
                movingCount: 0,
                speedReportedCount: 0,
              },
            ],
          },
          isFetching: false,
          error: null,
          isLoading: false,
        };
      }
      return {
        data: {
          data: [],
          meta: { total: 0, page: 1, limit: 20, totalPages: 1 },
        },
        isLoading: false,
      };
    });

    render(<FuelPage />);

    fireEvent.click(screen.getByRole("button", { name: "Rapport GPS" }));
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Analyser les positions" }),
      ).toBeInTheDocument();
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Analyser les positions" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("8 positions GPS enregistrées ce jour"),
      ).toBeInTheDocument();
      expect(screen.getByText("TRK-1")).toBeInTheDocument();
      expect(screen.getByText("TRK-2")).toBeInTheDocument();
    });

    // Le sous-comptage est expliqué, pas masqué : couverture clairsemée visible.
    expect(screen.getByText(/Couverture clairs[eé]m[eé]e/)).toBeInTheDocument();
    // Les colonnes brute/filtrée et les colonnes distance du rapport sont affichées.
    expect(screen.getByText("Brute / Filtrée")).toBeInTheDocument();
    expect(screen.getByText("Couverture")).toBeInTheDocument();
    // Ratio fixé : brute ≡ filtré pour V1 (déplacement réel), valeur visible.
    expect(screen.getAllByText("0.33").length).toBeGreaterThan(0);
  });
});
