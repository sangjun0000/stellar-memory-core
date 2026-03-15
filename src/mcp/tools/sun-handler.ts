/**
 * mcp/tools/sun-handler.ts — stellar://sun resource handler.
 *
 * Exports: handleSunResource
 */

import { getSunContent } from '../../engine/sun.js';
import { getUnresolvedConflicts } from '../../engine/conflict.js';
import { getTemporalSummary } from '../../engine/temporal.js';
import { formatProceduralSection } from '../../engine/procedural.js';
import { corona } from '../../engine/corona.js';
import { ensureCorona, resolveProject } from './shared.js';

// ---------------------------------------------------------------------------
// sun resource handler
// ---------------------------------------------------------------------------

export function handleSunResource(uriHref: string): { contents: [{ uri: string; text: string }] } {
  const proj = resolveProject();
  ensureCorona();
  let content = getSunContent(proj);

  // Extract procedural memories from corona cache (avoids full table scan).
  // Procedural memories with high importance are already in corona.
  const { core, near } = corona.getCoreAndNear();
  const proceduralMems = [...core, ...near]
    .filter(m => m.type === 'procedural')
    .sort((a, b) => b.importance - a.importance);
  if (proceduralMems.length > 0) {
    content += '\n\n' + formatProceduralSection(proceduralMems);
  }

  // Append temporal summary
  const temporalSummary = getTemporalSummary(proj);
  if (temporalSummary) {
    content += '\n\n' + temporalSummary;
  }

  // Append unresolved conflict count
  const unresolvedConflicts = getUnresolvedConflicts(proj);
  if (unresolvedConflicts.length > 0) {
    content += `\n\nUnresolved conflicts: ${unresolvedConflicts.length} — use resolve_conflict tool to review.`;
  }

  return { contents: [{ uri: uriHref, text: content }] };
}
