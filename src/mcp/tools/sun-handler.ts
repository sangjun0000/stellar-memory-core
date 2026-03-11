/**
 * mcp/tools/sun-handler.ts — stellar://sun resource handler.
 *
 * Exports: handleSunResource
 */

import { getSunContent } from '../../engine/sun.js';
import { getUnresolvedConflicts } from '../../engine/conflict.js';
import { getTemporalSummary } from '../../engine/temporal.js';
import { getProceduralMemories, formatProceduralSection } from '../../engine/procedural.js';
import { ensureCorona, resolveProject } from './shared.js';

// ---------------------------------------------------------------------------
// sun resource handler
// ---------------------------------------------------------------------------

export function handleSunResource(uriHref: string): { contents: [{ uri: string; text: string }] } {
  const proj = resolveProject();
  ensureCorona();
  let content = getSunContent(proj);

  // Append procedural memories section (Navigation Rules)
  const proceduralMems = getProceduralMemories(proj);
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
