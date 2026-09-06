// scheduledDate est une DATE pure stockée à minuit (ex: 2026-08-29T00:00:00.000Z),
// sans heure cible précise. Comparer completedAt <= scheduledDate revenait donc à
// exiger une livraison terminée avant minuit PILE le jour prévu — n'importe quelle
// livraison terminée après minuit ce même jour (l'immense majorité des cas réels)
// était comptée « en retard » alors qu'elle a eu lieu le bon jour. La notion
// correcte est : livrée au plus tard le jour prévu (n'importe quelle heure de ce
// jour), donc avant le début du jour SUIVANT.
export function isOnTime(completedAt: Date | null, scheduledDate: Date | null): boolean {
  if (!scheduledDate) return true;
  if (!completedAt) return false;
  const endOfScheduledDay = new Date(scheduledDate);
  endOfScheduledDay.setUTCDate(endOfScheduledDay.getUTCDate() + 1);
  return completedAt < endOfScheduledDay;
}
