import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface AssignVehicleParams {
  companyId: string;
  driverId: string;
  vehicleId: string;
  /** Instants utilisés pour assignedAt/unassignedAt (défaut : now()). */
  at?: Date;
}

export interface UnassignDriverParams {
  driverId: string;
  at?: Date;
}

/**
 * Écrit l'historique d'affectation conducteur ↔ véhicule dans le contexte d'une
 * transaction Prisma fournie par l'appelant (le tx est TOUJOURS le même que celui
 * qui met à jour la FK courante `driver.vehicleId` — jamais l'un sans l'autre).
 *
 * INVARIANT garanti : à un instant T, au plus une ligne OUVERTE (unassignedAt IS
 * NULL) par vehicleId ET au plus une ligne ouverte par driverId. Il est appliqué :
 *  1. en base, par deux index uniques partiels (voir la migration) ;
 *  2. ici, en séquencement : on ferme d'abord la/les ligne(s) ouverte(s)
 *     concernée(s), puis on ouvre la nouvelle.
 */
@Injectable()
export class VehicleAssignmentHistoryService {
  /**
   * Affecte `vehicleId` à `driverId` : ferme la ligne ouverte du véhicule (si elle
   * appartient à un autre conducteur), ferme la ligne ouverte du conducteur (cas
   * où il changeait déjà de véhicule), puis ouvre la nouvelle ligne.
   */
  async assign(tx: Prisma.TransactionClient, params: AssignVehicleParams) {
    const at = params.at ?? new Date();

    const openForVehicle = await tx.vehicleAssignmentHistory.findFirst({
      where: { vehicleId: params.vehicleId, unassignedAt: null },
      select: { id: true, driverId: true },
    });
    // NO-OP : le chauffeur demandé est DÉJÀ le conducteur de ce véhicule → AUCUNE écriture.
    // Sans ce garde, chaque sauvegarde du formulaire chauffeur (drivers.service/users.service
    // appellent assign() dès que dto.vehicleId est fourni, sans vérifier le changement)
    // fermait la ligne ouverte du chauffeur et en recréait une à "now" : assignedAt d'origine
    // perdu (source de vérité du backfill GPS) + 2 écritures inutiles par sauvegarde.
    // L'invariant « au plus une ligne ouverte par chauffeur » (index unique partiel) garantit
    // que si openForVehicle.driverId === params.driverId, le chauffeur n'a aucune autre ligne
    // ouverte ailleurs : le return anticipé est sûr.
    if (openForVehicle && openForVehicle.driverId === params.driverId) {
      return;
    }
    if (openForVehicle && openForVehicle.driverId !== params.driverId) {
      await tx.vehicleAssignmentHistory.update({
        where: { id: openForVehicle.id },
        data: { unassignedAt: at },
      });
    }

    const openForDriver = await tx.vehicleAssignmentHistory.findFirst({
      where: { driverId: params.driverId, unassignedAt: null },
      select: { id: true },
    });
    if (openForDriver) {
      await tx.vehicleAssignmentHistory.update({
        where: { id: openForDriver.id },
        data: { unassignedAt: at },
      });
    }

    await tx.vehicleAssignmentHistory.create({
      data: {
        companyId: params.companyId,
        vehicleId: params.vehicleId,
        driverId: params.driverId,
        assignedAt: at,
        unassignedAt: null,
      },
    });
  }

  /**
   * Désaffecte `driverId` (FK passée à null) : ferme sa ligne ouverte s'il y en a
   * une. Ne crée aucune nouvelle ligne.
   */
  async unassign(tx: Prisma.TransactionClient, params: UnassignDriverParams) {
    const at = params.at ?? new Date();
    await tx.vehicleAssignmentHistory.updateMany({
      where: { driverId: params.driverId, unassignedAt: null },
      data: { unassignedAt: at },
    });
  }
}
