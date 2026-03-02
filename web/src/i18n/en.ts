// English translations — canonical source of truth for keys
// Korean (ko.ts) MUST mirror this exact structure

const en = {
  // ── Layout ────────────────────────────────────────────────────
  layout: {
    brand: 'Stellar Memory',
    subtitle: 'SOLAR SYSTEM DASHBOARD',
    online: 'ONLINE',
  },

  // ── Tabs (with description for UX) ────────────────────────────
  tabs: {
    solar:     { label: 'Solar System', description: '3D memory visualization' },
    analytics: { label: 'Analytics',    description: 'Health & distribution charts' },
    conflicts: { label: 'Conflicts',    description: 'Resolve contradictions' },
    rules:     { label: 'Rules',        description: 'Repeated pattern rules' },
  },

  // ── Sidebar ───────────────────────────────────────────────────
  sidebar: {
    project: 'Project',
    actions: 'Actions',
    recalculateOrbits: 'Recalculate orbits',
  },

  // ── StatsBar ──────────────────────────────────────────────────
  statsBar: {
    memories: 'Memories',
    quality: 'Quality',
    rules: 'Rules',
    orbit: 'Orbit',
    updated: 'Updated',
    syncing: 'Syncing…',
    refresh: 'Refresh',
    qualityTooltip: 'Average quality score across all memories',
    conflictsTooltip: 'Number of unresolved memory conflicts',
    rulesTooltip: 'Active procedural navigation rules',
    universalTooltip: 'Memories shared across all projects',
    orbitTooltip: 'Time since last orbit recalculation',
  },

  // ── SearchBar ─────────────────────────────────────────────────
  search: {
    placeholder: 'Search the memory field…',
    button: 'Search',
    scanning: 'Scanning',
    clear: 'Clear search',
    allTypes: 'All types',
    allZones: 'All zones',
    filterByType: 'Filter by type',
    filterByZone: 'Filter by zone',
    result: 'result',
    results: 'results',
  },

  // ── Memory types (shared across many components) ──────────────
  memoryTypes: {
    decision:    'Decision',
    error:       'Error',
    task:        'Task',
    observation: 'Observation',
    milestone:   'Milestone',
    context:     'Context',
    procedural:  'Procedural',
  } as Record<string, string>,

  // ── Orbit zones ───────────────────────────────────────────────
  zones: {
    core:      { name: 'Core',      description: 'Core memories — highest importance' },
    near:      { name: 'Recent',    description: 'Recently important memories' },
    active:    { name: 'Active',    description: 'Active working memories' },
    archive:   { name: 'Stored',    description: 'Stored but rarely accessed' },
    fading:    { name: 'Fading',    description: 'Gradually fading memories' },
    forgotten: { name: 'Forgotten', description: 'Approaching extinction threshold' },
  } as Record<string, { name: string; description: string }>,

  zoneLabels: {
    all: 'All zones',
    total: 'total',
  },

  // ── ZoneStats panel ───────────────────────────────────────────
  zoneStats: {
    header: 'Orbital Zones',
    description: 'Memory distribution by orbit distance',
  },

  // ── DataSources ───────────────────────────────────────────────
  dataSources: {
    header: 'Data Sources',
    scanning: 'SCANNING...',
    noSources: 'No sources registered',
    statusActive: 'Active',
    statusInactive: 'Inactive',
    statusError: 'Error',
    file: 'file',
    files: 'files',
    scanned: 'scanned',
  },

  // ── ProjectSwitcher ───────────────────────────────────────────
  projectSwitcher: {
    projects: 'Projects',
    newProject: 'New project',
    create: 'Create',
    hasUniversal: 'Has universal memories',
  },

  // ── Sun detail panel ──────────────────────────────────────────
  sun: {
    header: 'Sun State',
    noState: 'No sun state committed yet.',
    currentWork: 'Current Work',
    recentDecisions: 'Recent Decisions',
    nextSteps: 'Next Steps',
    activeErrors: 'Active Errors',
    tokens: 'Tokens',
    committed: 'Committed',
    never: 'never',
  },

  // ── MemoryDetail ──────────────────────────────────────────────
  memoryDetail: {
    untitled: 'Untitled Memory',
    content: 'Content',
    properties: 'Properties',
    temporal: 'Temporal',
    universal: 'Universal',
    source: 'Source',
    allTags: 'All Tags',
    timeline: 'Timeline',
    metadata: 'Metadata',
    collapse: 'Collapse',
    expand: 'Expand',
    chars: 'chars',
    importance: 'Importance',
    impact: 'Impact',
    type: 'Type',
    zone: 'Zone',
    distance: 'Distance',
    velocity: 'Velocity',
    accessed: 'Accessed',
    valid: 'Valid',
    present: 'present',
    supersededBy: 'Superseded by',
    consolidatedInto: 'Consolidated into',
    universalDesc: 'Universal memories are shared across all projects and included in every context.',
    markUniversal: 'Mark universal',
    removeUniversal: 'Remove universal',
    universalBadge: 'Universal memory — shared across all projects',
    open: 'Open',
    copy: 'Copy',
    copyContent: 'Copy content',
    confirmDelete: 'Confirm delete?',
    cancel: 'Cancel',
    forget: 'Forget',
    close: 'Close',
    dismiss: 'Dismiss',
    created: 'Created',
    lastAccess: 'Last access',
    updated: 'Updated',
    more: 'more',
    qualityGood: 'Good',
    qualityFair: 'Fair',
    qualityLow: 'Low',
    conflicts: 'Conflicts',
  },

  // ── OnboardingScreen ──────────────────────────────────────────
  onboarding: {
    welcome: 'Welcome to Stellar Memory',
    emptyDesc: 'Your solar system is empty.\nScan files to populate it with memories.',
    fullScan: 'Full Scan',
    fullScanDesc: 'Explore entire\nhome directory',
    selectFolders: 'Select Folders',
    selectFoldersDesc: 'Choose specific\ndirectories',
    skip: 'Skip — add memories manually',
    selectFoldersTitle: 'Select Folders to Scan',
    enterPaths: 'Enter full paths to directories you want to scan.',
    addFolder: '+ Add folder',
    back: 'Back',
    startScan: 'Start Scan',
    scanningFiles: 'Scanning Files',
    discoveryDesc: 'Discovering and processing your files...',
    filesScanned: 'files scanned',
    memoriesCreated: 'memories created',
    complete: 'complete',
    cancel: 'Cancel',
    scanComplete: 'Scan Complete',
    duration: 'duration',
    explore: 'Explore Solar System',
    initializing: 'Initializing...',
    collectingFrom: 'Collecting files from',
  },

  // ── AnalyticsDashboard ────────────────────────────────────────
  analytics: {
    failedToLoad: 'Failed to load analytics',
    totalMemories: 'Total Memories',
    activeRatio: 'Active Ratio',
    avgQuality: 'Avg Quality',
    staleMemories: 'Stale Memories',
    conflicts: 'Conflicts',
    accessedRecently: 'memories accessed recently',
    acrossAll: 'across all memories',
    notAccessed30: 'not accessed in 30+ days',
    unresolved: 'unresolved',
    noneDetected: 'none detected',
    zoneDistribution: 'Zone Distribution',
    memoryTypes: 'Memory Types',
    noZoneData: 'No zone data.',
    noTypeData: 'No type data.',
    survivalCurve: 'Memory Survival Curve',
    surviving: 'Surviving',
    forgotten: 'Forgotten',
    notEnoughData: 'Not enough data to draw a survival curve yet.',
    topicClusters: 'Topic Clusters',
    noTopicClusters: 'No topic clusters yet.',
    recommendations: 'Recommendations',
    allHealthy: 'All looks healthy — no recommendations.',
    topTags: 'Top Tags',
    noTags: 'No tags yet.',
    recallSuccess: 'Recall Success',
    avgImportance: 'Avg Importance',
    consolidations: 'Consolidations',
    memoriesMerged: 'memories merged',
    consolidationOps: 'Consolidation Ops',
    similarFound: 'similar memories found',
    topic: 'Topic',
    count: 'Count',
    avgImportanceCol: 'Avg Importance',
    activity7d: 'Activity (7d)',
  },

  // ── ConflictsPanel ────────────────────────────────────────────
  conflictsPanel: {
    unresolvedConflicts: 'Unresolved Conflicts',
    noConflicts: 'No conflicts detected',
    allConsistent: 'All memories are consistent',
    retry: 'Retry',
    memory: 'Memory',
    supersede: 'Supersede',
    keepBoth: 'Keep Both',
    dismiss: 'Dismiss',
  },

  // ── ConsolidationPanel ────────────────────────────────────────
  consolidation: {
    header: 'Consolidation Candidates',
    description: 'Find and merge similar memories',
    runAuto: 'Run Auto-Consolidation',
    running: 'Running…',
    groupsFound: 'Groups found',
    consolidated: 'Consolidated',
    newMemories: 'New memories',
    noCandidates: 'No consolidation candidates found',
    allDistinct: 'All memories appear to be sufficiently distinct',
    memories: 'memories',
    similar: 'similar',
    merge: 'Merge',
    merging: 'Merging…',
  },

  // ── ObservationLog ────────────────────────────────────────────
  observation: {
    header: 'Observation Log',
    description: 'Recorded observations and reflections',
    noObservations: 'No observations yet',
    useObserve: 'Use the observe MCP tool to start.',
    showMore: '… show more',
    showLess: 'show less',
    memoriesExtracted: 'memories extracted',
    retry: 'Retry',
  },

  // ── ProceduralRules ───────────────────────────────────────────
  rules: {
    header: 'Navigation Rules',
    noRules: 'No navigation rules learned yet',
    noRulesDesc: 'Rules are automatically detected from repeated patterns.\nContinue working with Stellar Memory to build them up.',
    footer: 'Rules are automatically detected from repeated patterns.',
    forget: 'Forget',
    retry: 'Retry',
  },

  // ── TemporalTimeline ──────────────────────────────────────────
  temporal: {
    header: 'Temporal Timeline',
    selectMemory: 'Select a memory to view its evolution chain,\nor use Time Travel below.',
    noHistory: 'This memory has no evolution history.',
    evolutionChain: 'Evolution Chain',
    node: 'node',
    nodes: 'nodes',
    supersededBy: 'superseded by',
    superseded: 'superseded',
    fullContent: 'Full Content',
    timeTravel: 'Time Travel',
    viewContext: 'View context',
    traveling: 'Traveling…',
    noMemoriesAtTime: 'No memories found at that point in time.',
    memoriesActiveOn: 'memories active on',
  },

  // ── Common ────────────────────────────────────────────────────
  common: {
    loading: 'Loading...',
    close: 'Close',
    never: 'never',
  },

  // ── Relative time ─────────────────────────────────────────────
  time: {
    secondsAgo: (n: number) => `${n}s ago`,
    minutesAgo: (n: number) => `${n}m ago`,
    hoursAgo:   (n: number) => `${n}h ago`,
    daysAgo:    (n: number) => `${n}d ago`,
    never: 'never',
  },

  // ── Language toggle ───────────────────────────────────────────
  language: {
    en: 'EN',
    ko: 'KO',
  },
} as const;

// Widen all string literal types to `string` so ko.ts can use different values
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => R
    : T extends Record<string, unknown>
      ? { [K in keyof T]: Widen<T[K]> }
      : T;

export type Translations = Widen<typeof en>;
export default en;
