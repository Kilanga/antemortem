import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Text, Strong, Em, Lozenge, Link, Stack, Inline, Spinner, Box } from '@forge/react';
import { invoke, view } from '@forge/bridge';

/**
 * Issue context panel: where Antemortem meets people where they work.
 * On an issue, shows which obligations it feeds, which decisions/assumptions
 * mention it, and whether it appears in a projected post-mortem.
 */
const App = () => {
  const [data, setData] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const ctx = await view.getContext();
        const issueKey = ctx?.extension?.issue?.key ?? ctx?.platformContext?.issueKey;
        const res = await invoke('getIssueContext', { issueKey });
        setData(res);
      } catch (err) {
        setData({ ok: false, error: String(err?.message ?? err) });
      }
    })();
  }, []);

  if (!data) return <Spinner size="small" />;
  if (!data.ok) return <Text><Em>Antemortem: {data.error}</Em></Text>;

  const { obligations, incidents, assumptions, decisions } = data;
  const nothing = !obligations.length && !incidents.length && !assumptions.length && !decisions.length;
  if (nothing) return <Text><Em>Not linked to any obligation, decision or projected incident.</Em></Text>;

  return (
    <Stack space="space.150">
      {incidents.map((fi) => (
        <Box key={fi.id}>
          <Inline space="space.100" alignBlock="center">
            <Lozenge appearance="removed" isBold>{fi.role === 'action' ? 'Corrective action' : 'In a projected incident'}</Lozenge>
            <Text><Strong>{Math.round((fi.probability ?? 0) * 100)} %</Strong></Text>
          </Inline>
          <Text>{fi.url ? <Link href={fi.url} openNewTab>{fi.title}</Link> : fi.title}</Text>
          <Text><Em>Projected for {fi.incidentDate} · {fi.cost}</Em></Text>
        </Box>
      ))}
      {obligations.map((o) => (
        <Box key={o.id}>
          <Inline space="space.100" alignBlock="center">
            <Lozenge appearance={o.probability >= 0.6 ? 'removed' : o.probability >= 0.3 ? 'moved' : 'success'}>{o.code}</Lozenge>
            <Text>{o.title}</Text>
          </Inline>
          {o.probability != null && <Text><Em>Feeds this obligation · breach probability {Math.round(o.probability * 100)} %{o.breachDate ? ` by ${o.breachDate}` : ''}</Em></Text>}
        </Box>
      ))}
      {assumptions.map((a) => (
        <Box key={a.id}>
          <Inline space="space.100" alignBlock="center">
            <Lozenge appearance={a.status === 'broken' ? 'removed' : a.status === 'shaken' ? 'moved' : 'success'}>assumption {a.status}</Lozenge>
          </Inline>
          <Text>{a.statement}</Text>
          <Text><Em>Behind: {a.decisionTitle}</Em></Text>
        </Box>
      ))}
      {decisions.map((d) => (
        <Box key={d.id}>
          <Lozenge appearance={d.status === 'contradicted' ? 'removed' : 'inprogress'}>decision {d.status}</Lozenge>
          <Text>{d.title}</Text>
        </Box>
      ))}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
