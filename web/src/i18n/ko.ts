import type { Translations } from './en';

const ko: Translations = {
  // ── Layout ────────────────────────────────────────────────────
  layout: {
    brand: 'Stellar Memory',
    subtitle: '태양계 대시보드',
    online: '온라인',
  },

  // ── Tabs ──────────────────────────────────────────────────────
  tabs: {
    solar:     { label: '태양계',   description: '3D 기억 시각화' },
    analytics: { label: '분석',     description: '건강도·분포 차트' },
    conflicts: { label: '충돌',     description: '모순 기억 해결' },
    rules:     { label: '규칙',     description: '반복 패턴 규칙' },
  },

  // ── Sidebar ───────────────────────────────────────────────────
  sidebar: {
    project: '프로젝트',
    actions: '작업',
    recalculateOrbits: '궤도 재계산',
  },

  // ── StatsBar ──────────────────────────────────────────────────
  statsBar: {
    memories: '기억',
    quality: '품질',
    rules: '규칙',
    orbit: '궤도',
    updated: '갱신',
    syncing: '동기화 중…',
    refresh: '새로고침',
    qualityTooltip: '전체 기억의 평균 품질 점수',
    conflictsTooltip: '미해결 기억 충돌 수',
    rulesTooltip: '활성 절차적 탐색 규칙',
    universalTooltip: '모든 프로젝트에 공유되는 기억',
    orbitTooltip: '마지막 궤도 재계산 이후 시간',
  },

  // ── SearchBar ─────────────────────────────────────────────────
  search: {
    placeholder: '기억을 검색하세요…',
    button: '검색',
    scanning: '검색 중',
    clear: '검색 지우기',
    allTypes: '모든 유형',
    allZones: '모든 궤도',
    filterByType: '유형별 필터',
    filterByZone: '궤도별 필터',
    result: '건',
    results: '건',
  },

  // ── Memory types ──────────────────────────────────────────────
  memoryTypes: {
    decision:    '결정',
    error:       '오류',
    task:        '작업',
    observation: '관찰',
    milestone:   '마일스톤',
    context:     '맥락',
    procedural:  '절차',
  } as Record<string, string>,

  // ── Orbit zones ───────────────────────────────────────────────
  zones: {
    core:      { name: '핵심',   description: '핵심 기억 — 최고 중요도' },
    near:      { name: '최근',   description: '최근에 중요했던 기억' },
    active:    { name: '활성',   description: '현재 활용 중인 기억' },
    archive:   { name: '보관',   description: '저장됨, 자주 안 꺼냄' },
    fading:    { name: '흐린',   description: '점점 잊혀지는 기억' },
    forgotten: { name: '잊힌',   description: '거의 소멸 직전의 기억' },
  } as Record<string, { name: string; description: string }>,

  zoneLabels: {
    all: '모든 궤도',
    total: '합계',
  },

  // ── ZoneStats panel ───────────────────────────────────────────
  zoneStats: {
    header: '궤도 영역',
    description: '궤도 거리별 기억 분포',
  },

  // ── DataSources ───────────────────────────────────────────────
  dataSources: {
    header: '데이터 소스',
    scanning: '스캔 중...',
    noSources: '등록된 소스 없음',
    statusActive: '활성',
    statusInactive: '비활성',
    statusError: '오류',
    file: '파일',
    files: '파일',
    scanned: '스캔',
    addSource: '폴더 추가',
    pathPlaceholder: 'C:\\Users\\... 또는 폴더 경로',
    scan: '스캔',
    cancel: '취소',
    scanProgress: '스캔 중...',
    scanComplete: '스캔 완료',
    created: '생성',
    memories: '기억',
    scanError: '스캔 실패',
  },

  // ── ProjectSwitcher ───────────────────────────────────────────
  projectSwitcher: {
    projects: '프로젝트',
    newProject: '새 프로젝트',
    create: '생성',
    hasUniversal: '범용 기억 포함',
  },

  // ── Sun detail panel ──────────────────────────────────────────
  sun: {
    header: '태양 상태',
    noState: '아직 커밋된 태양 상태가 없습니다.',
    currentWork: '현재 작업',
    recentDecisions: '최근 결정',
    nextSteps: '다음 단계',
    activeErrors: '활성 오류',
    tokens: '토큰',
    committed: '커밋',
    never: '없음',
  },

  // ── MemoryDetail ──────────────────────────────────────────────
  memoryDetail: {
    untitled: '제목 없는 기억',
    content: '내용',
    properties: '속성',
    temporal: '시간 정보',
    universal: '범용',
    source: '소스',
    allTags: '모든 태그',
    timeline: '타임라인',
    metadata: '메타데이터',
    collapse: '접기',
    expand: '펼치기',
    chars: '자',
    importance: '중요도',
    impact: '영향',
    type: '유형',
    zone: '궤도',
    distance: '거리',
    velocity: '속도',
    accessed: '접근 횟수',
    valid: '유효 기간',
    present: '현재',
    supersededBy: '대체됨',
    consolidatedInto: '통합됨',
    universalDesc: '범용 기억은 모든 프로젝트에서 공유되며 모든 컨텍스트에 포함됩니다.',
    markUniversal: '범용으로 표시',
    removeUniversal: '범용 해제',
    universalBadge: '범용 기억 — 모든 프로젝트에 공유',
    open: '열기',
    copy: '복사',
    copyContent: '내용 복사',
    confirmDelete: '정말 삭제할까요?',
    cancel: '취소',
    forget: '잊기',
    close: '닫기',
    dismiss: '무시',
    created: '생성일',
    lastAccess: '마지막 접근',
    updated: '수정일',
    more: '더',
    qualityGood: '양호',
    qualityFair: '보통',
    qualityLow: '낮음',
    conflicts: '충돌',
  },

  // ── OnboardingScreen ──────────────────────────────────────────
  onboarding: {
    welcome: 'Stellar Memory에 오신 것을 환영합니다',
    emptyDesc: '태양계가 비어 있습니다.\n파일을 스캔하여 기억으로 채우세요.',
    fullScan: '전체 스캔',
    fullScanDesc: '전체 홈 디렉토리\n탐색',
    selectFolders: '폴더 선택',
    selectFoldersDesc: '특정 디렉토리\n선택',
    skip: '건너뛰기 — 수동으로 기억 추가',
    selectFoldersTitle: '스캔할 폴더 선택',
    enterPaths: '스캔할 디렉토리의 전체 경로를 입력하세요.',
    addFolder: '+ 폴더 추가',
    back: '뒤로',
    startScan: '스캔 시작',
    scanningFiles: '파일 스캔 중',
    discoveryDesc: '파일을 탐색하고 처리하는 중입니다...',
    filesScanned: '스캔된 파일',
    memoriesCreated: '생성된 기억',
    complete: '완료',
    cancel: '취소',
    scanComplete: '스캔 완료',
    duration: '소요 시간',
    explore: '태양계 탐험하기',
    initializing: '초기화 중...',
    collectingFrom: '파일 수집 중:',
  },

  // ── AnalyticsDashboard ────────────────────────────────────────
  analytics: {
    failedToLoad: '분석을 불러오지 못했습니다',
    totalMemories: '총 기억 수',
    activeRatio: '활성 비율',
    avgQuality: '평균 품질',
    staleMemories: '오래된 기억',
    conflicts: '충돌',
    accessedRecently: '최근 접근된 기억',
    acrossAll: '전체 기억 기준',
    notAccessed30: '30일 이상 미접근',
    unresolved: '미해결',
    noneDetected: '감지된 충돌 없음',
    zoneDistribution: '궤도 분포',
    memoryTypes: '기억 유형',
    noZoneData: '궤도 데이터 없음.',
    noTypeData: '유형 데이터 없음.',
    survivalCurve: '기억 생존 곡선',
    surviving: '생존',
    forgotten: '잊힘',
    notEnoughData: '생존 곡선을 그리기에 데이터가 부족합니다.',
    topicClusters: '주제 클러스터',
    noTopicClusters: '아직 주제 클러스터가 없습니다.',
    recommendations: '추천',
    allHealthy: '모두 건강합니다 — 추천 사항 없음.',
    topTags: '상위 태그',
    noTags: '아직 태그가 없습니다.',
    recallSuccess: '리콜 성공률',
    avgImportance: '평균 중요도',
    consolidations: '통합',
    memoriesMerged: '통합된 기억',
    consolidationOps: '통합 기회',
    similarFound: '유사한 기억 발견',
    topic: '주제',
    count: '수',
    avgImportanceCol: '평균 중요도',
    activity7d: '활동 (7일)',
  },

  // ── ConflictsPanel ────────────────────────────────────────────
  conflictsPanel: {
    unresolvedConflicts: '미해결 충돌',
    noConflicts: '충돌이 감지되지 않았습니다',
    allConsistent: '모든 기억이 일관성이 있습니다',
    retry: '재시도',
    memory: '기억',
    supersede: '대체',
    keepBoth: '둘 다 유지',
    dismiss: '무시',
  },

  // ── ConsolidationPanel ────────────────────────────────────────
  consolidation: {
    header: '통합 후보',
    description: '유사한 기억 찾기 및 병합',
    runAuto: '자동 통합 실행',
    running: '실행 중…',
    groupsFound: '발견된 그룹',
    consolidated: '통합됨',
    newMemories: '새 기억',
    noCandidates: '통합 후보를 찾지 못했습니다',
    allDistinct: '모든 기억이 충분히 구별됩니다',
    memories: '기억',
    similar: '유사',
    merge: '병합',
    merging: '병합 중…',
  },

  // ── ObservationLog ────────────────────────────────────────────
  observation: {
    header: '관찰 기록',
    description: '기록된 관찰 및 반영',
    noObservations: '아직 관찰이 없습니다',
    useObserve: 'observe MCP 도구를 사용하여 시작하세요.',
    showMore: '… 더 보기',
    showLess: '접기',
    memoriesExtracted: '기억 추출됨',
    retry: '재시도',
  },

  // ── ProceduralRules ───────────────────────────────────────────
  rules: {
    header: '탐색 규칙',
    noRules: '아직 학습된 탐색 규칙이 없습니다',
    noRulesDesc: '규칙은 반복 패턴에서 자동으로 감지됩니다.\nStellar Memory를 계속 사용하여 규칙을 쌓아가세요.',
    footer: '규칙은 반복 패턴에서 자동으로 감지됩니다.',
    forget: '잊기',
    retry: '재시도',
  },

  // ── TemporalTimeline ──────────────────────────────────────────
  temporal: {
    header: '시간 타임라인',
    selectMemory: '진화 체인을 보려면 기억을 선택하거나,\n아래 시간 여행을 사용하세요.',
    noHistory: '이 기억은 진화 이력이 없습니다.',
    evolutionChain: '진화 체인',
    node: '노드',
    nodes: '노드',
    supersededBy: '대체됨',
    superseded: '대체됨',
    fullContent: '전체 내용',
    timeTravel: '시간 여행',
    viewContext: '컨텍스트 보기',
    traveling: '이동 중…',
    noMemoriesAtTime: '해당 시점에 기억이 없습니다.',
    memoriesActiveOn: '활성 기억 날짜:',
  },

  // ── Common ────────────────────────────────────────────────────
  common: {
    loading: '로딩 중...',
    close: '닫기',
    never: '없음',
  },

  // ── Relative time ─────────────────────────────────────────────
  time: {
    secondsAgo: (n: number) => `${n}초 전`,
    minutesAgo: (n: number) => `${n}분 전`,
    hoursAgo:   (n: number) => `${n}시간 전`,
    daysAgo:    (n: number) => `${n}일 전`,
    never: '없음',
  },

  // ── Language toggle ───────────────────────────────────────────
  language: {
    en: 'EN',
    ko: 'KO',
  },
};

export default ko;
