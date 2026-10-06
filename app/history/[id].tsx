import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { formatLongDate } from '@/domain/format';
import { loadSummary, type SessionSummary } from '@/features/session/controller';
import { copy } from '@/ui/copy';
import { HistoryScreen } from '@/ui/components/HistoryScreen';
import { SummaryView } from '@/ui/components/SummaryView';

// History · one past session, as the end-of-session summary shows it (screen 7).
export default function PastSessionRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  useEffect(() => {
    void loadSummary(db, id).then(setSummary);
  }, [db, id]);

  return <HistoryScreen title={summary ? formatLongDate(summary.date) : copy.history.yourSessions}>{summary && <SummaryView summary={summary} />}</HistoryScreen>;
}
