export type Character = {
  id: string;
  name: string;
  description: string;
};

/*
 * =========================================================
 * ALLGEMEINE VIDEO-ARCHITEKTUR
 *
 * Dauer, Bildformat und Schnittstil sind getrennte Dinge.
 * =========================================================
 */

export type VideoDurationSeconds =
  | 8 // Nur Legacy für bereits bestehende alte Aufträge
  | 15
  | 30
  | 60
  | 120
  | 180
  | 240
  | 300;

export type VideoAspectRatio =
  | "9:16"
  | "16:9";

export type VideoEditingStyle =
  | "auto"
  | "social"
  | "cinematic"
  | "music-video";

export type VideoAudioStyle =
  | "cinematic"
  | "emotional"
  | "upbeat"
  | "electronic"
  | "ambient"
  | "no-music";

export type VideoVoiceMode =
  | "auto"
  | "dialogue"
  | "voiceover"
  | "no-voice";

export type VideoSpokenLanguage =
  | "auto"
  | "de"
  | "en";

export type VideoCreationMode =
  | "standard"
  | "viral-story";

export type MusicVideoTrackContext = {
  name: string;
  durationSeconds: number;
  analysis: string;
};

export type VideoProvider =
  | "auto"
  | "veo"
  | "runway"
  | "seedance";

export const VIDEO_MODEL_IDS = [
  "seedance-2-fast",
  "seedance-2-original",
  "google-veo",
] as const;

export type VideoModelId =
  (typeof VIDEO_MODEL_IDS)[number];

export function isVideoModelId(
  value: unknown,
): value is VideoModelId {
  return (
    typeof value === "string" &&
    VIDEO_MODEL_IDS.includes(
      value as VideoModelId,
    )
  );
}

export type VideoGenerationStrategy =
  | "single-shot"
  | "extension-chain"
  | "chaptered";

/*
 * =========================================================
 * PRODUCTION BIBLE
 * =========================================================
 */

export type CharacterBibleEntry = {
  id: string;
  name: string;
  role: string;

  fixedAppearance: string;
  faceIdentity: string;

  hair: string;
  eyes: string;
  bodyType: string;

  clothing: string;
  accessories: string;

  movementStyle: string;
  voiceIdentity: string;
};

export type VisualBible = {
  visualStyle: string;
  colorGrade: string;
  lightingStyle: string;
  realismLevel: string;

  environmentRules: string;
  continuityRules: string;
};

export type CameraBible = {
  cameraStyle: string;
  lensStyle: string;
  frameRate: string;

  motionStyle: string;
  compositionRules: string;
  transitionRules: string;
};

export type AudioBible = {
  dialogueLanguage: string;
  ambienceStyle: string;
  musicStyle: string;

  soundContinuityRules: string;
  dialogueRules: string;
};

/*
 * Regieebenen für kurze und lange Video-Pipelines.
 */

export type ViralBible = {
  hookStrategy: string;
  retentionStrategy: string;

  escalationStrategy: string;
  emotionalArc: string;

  payoffStrategy: string;
  cliffhangerStrategy: string;

  pacingRules: string;
};

export type PerformanceBible = {
  actingStyle: string;
  facialExpressionStyle: string;

  bodyLanguageStyle: string;
  dialogueDeliveryStyle: string;

  realismRules: string;
};

export type LightingBible = {
  primaryLightingStyle: string;
  lightDirection: string;

  contrastStyle: string;
  exposureStyle: string;

  practicalLights: string;
  continuityRules: string;
};

export type ProductionBible = {
  characterBible: CharacterBibleEntry[];

  visualBible: VisualBible;
  cameraBible: CameraBible;
  audioBible: AudioBible;

  viralBible?: ViralBible;
  performanceBible?: PerformanceBible;
  lightingBible?: LightingBible;
};

/*
 * =========================================================
 * DIALOGUE
 * =========================================================
 */

export type SceneDialogue = {
  enabled: boolean;

  speaker: string;
  text: string;

  language: string;
  voiceDirection: string;
};

/*
 * =========================================================
 * ALTE SZENENSTRUKTUR
 *
 * Bleibt zunächst erhalten, damit bestehende Komponenten,
 * Prompt Engineer und alte Render-Funktionen weiterhin
 * kompilieren.
 * =========================================================
 */

export type Scene = {
  id: number;
  title: string;

  description: string;

  location: string;
  mood: string;

  keyAction: string;
  visualFocus: string;

  startFrame: string;
  endingFrame: string;

  characterStateAtStart: string;
  characterStateAtEnd: string;

  environmentStateAtStart: string;
  environmentStateAtEnd: string;

  cameraStateAtStart: string;
  cameraStateAtEnd: string;

  lightingState: string;
  continuityNotes: string;

  dialogue: SceneDialogue;

  /*
   * Zusätzliche Sprecherwechsel innerhalb desselben Clips.
   */
  dialogueTurns?: SceneDialogue[];

  durationSeconds: number;

  /*
   * Prompt Engineer
   */
  veoPrompt?: string;
  audioPrompt?: string;
  negativePrompt?: string;

  camera?: string;
  lighting?: string;
  transition?: string;
  style?: string;

  /*
   * Generierung
   */
  operationName?: string;

  videoUrl?: string;
  videoUri?: string;

  referenceImageUrl?: string;
  previousLastFrameUrl?: string;

  firstFrameUrl?: string;
  lastFrameUrl?: string;

  generationStatus?:
    | "idle"
    | "pending"
    | "processing"
    | "completed"
    | "failed";

  generationError?: string;
};

/*
 * =========================================================
 * VARIABLE VIDEO-ARCHITEKTUR
 * =========================================================
 */

/*
 * Der erste Abschnitt ist bei neuen Seedance-Aufträgen
 * normalerweise ein 15-Sekunden-Clip.
 *
 * Die Felder bleiben absichtlich number, damit alte
 * 8-Sekunden-Aufträge weiterhin kompatibel bleiben.
 */
export type MovieOpening = {
  id: "opening";

  title: string;

  startSecond: 0;
  endSecond: number;

  durationSeconds: number;

  storyBeat: string;

  hook: string;
  emotionalBeat: string;

  action: string;

  location: string;

  characterState: string;
  environmentState: string;

  cameraPlan: string;
  lightingPlan: string;

  performancePlan: string;
  audioPlan: string;

  dialogue: SceneDialogue;

  dialogueTurns?: SceneDialogue[];

  /*
   * Produktionsfertige Anweisungen.
   */
  veoPrompt: string;
  audioPrompt: string;
  negativePrompt: string;
};

/*
 * Bei Seedance werden neue Fortsetzungen ebenfalls
 * als 15-Sekunden-Blöcke erzeugt.
 *
 * number bleibt für Legacy-Aufträge erhalten.
 */
export type MovieContinuation = {
  id: number;

  title: string;

  extensionNumber: number;

  startSecond: number;
  endSecond: number;

  durationSeconds: number;

  storyBeat: string;

  emotionalBeat: string;
  escalationPurpose: string;

  actionContinuation: string;

  characterContinuity: string;
  environmentContinuity: string;

  cameraContinuation: string;
  lightingContinuation: string;

  performanceContinuation: string;
  audioContinuation: string;

  dialogue: SceneDialogue;
  dialogueTurns?: SceneDialogue[];

  continuationPrompt: string;

  audioPrompt?: string;
  negativePrompt?: string;
};

export type VideoChapter = {
  id: number;

  title: string;

  startSecond: number;
  endSecond: number;

  targetDurationSeconds: number;
  generatedDurationSeconds?: number;

  storyGoal: string;
  visualGoal: string;

  openingPrompt?: string;
  continuationPrompts?: string[];

  transitionIn?: string;
  transitionOut?: string;

  completed?: boolean;
  videoUri?: string;
  error?: string;
};

/*
 * Gesamter Video-Plan.
 *
 * Neue freigegebene Ziel-Längen:
 * 15 s, 30 s, 60 s und 120 s.
 *
 * 8 s bleibt ausschließlich für alte Aufträge bestehen.
 * 180–300 s bleiben für spätere Freischaltung vorbereitet.
 */
export type MoviePlan = {
  targetDurationSeconds: VideoDurationSeconds;

  generatedDurationSeconds: number;

  aspectRatio: VideoAspectRatio;

  editingStyle?: VideoEditingStyle;

  provider?: VideoProvider;

  videoModel?: VideoModelId;

  generationStrategy?: VideoGenerationStrategy;

  opening: MovieOpening;

  continuations: MovieContinuation[];

  chapters?: VideoChapter[];

  endingStrategy: string;

  finalPayoff: string;
  finalCliffhanger: string;

  characterContinuityRules: string;
  visualContinuityRules: string;

  cameraContinuityRules: string;
  lightingContinuityRules: string;

  audioContinuityRules: string;
  storyContinuityRules: string;
};

/*
 * =========================================================
 * PRODUCTION MEMORY
 * =========================================================
 */

export type CharacterMemory = {
  characterId: string;
  name: string;

  faceIdentity: string;
  hair: string;
  eyes: string;
  bodyType: string;

  clothing: string;
  accessories: string;

  movementStyle: string;
  voiceIdentity: string;

  currentPosition?: string;
  currentPose?: string;

  currentAction?: string;
  currentEmotion?: string;

  visibleInSceneIds: number[];

  lastSeenSceneId?: number;
};

export type LocationMemory = {
  id: string;
  name: string;

  description: string;

  environmentState: string;

  timeOfDay: string;
  weather: string;

  lighting: string;

  permanentObjects: string[];
  activeProps: string[];

  lastUsedSceneId?: number;
};

export type PropMemory = {
  id: string;
  name: string;

  description: string;

  ownerCharacterId?: string;

  currentLocation: string;
  currentState: string;

  firstSeenSceneId?: number;
  lastSeenSceneId?: number;
};

export type SceneContinuityMemory = {
  sceneId: number;

  location: string;

  characterStateAtEnd: string;
  environmentStateAtEnd: string;

  cameraStateAtEnd: string;
  lightingStateAtEnd: string;

  movementDirection?: string;

  activeProps?: string[];

  continuityNotes?: string;

  firstFrameUrl?: string;
  lastFrameUrl?: string;
};

export type MovieExtensionMemory = {
  extensionNumber: number;

  approximateDurationSeconds: number;

  operationName?: string;

  videoUri?: string;

  completed: boolean;

  completedAt?: string;

  storyState: string;

  characterState: string;
  environmentState: string;

  cameraState: string;
  lightingState: string;

  audioState: string;

  error?: string;
};

export type ProductionMemory = {
  characters: CharacterMemory[];

  locations: LocationMemory[];
  props: PropMemory[];

  sceneContinuity: SceneContinuityMemory[];

  currentSceneId?: number;
  lastCompletedSceneId?: number;

  movieExtensions?: MovieExtensionMemory[];

  currentExtensionNumber?: number;

  lastCompletedExtensionNumber?: number;

  currentVideoUri?: string;

  approximateVideoDurationSeconds?: number;

  targetDurationSeconds?: VideoDurationSeconds;

  currentChapterNumber?: number;
  lastCompletedChapterNumber?: number;

  provider?: VideoProvider;

  aspectRatio?: VideoAspectRatio;
  editingStyle?: VideoEditingStyle;

  globalVisualStyle: string;
  globalColorGrade: string;

  globalCameraLanguage: string;
  globalLightingStyle: string;

  globalAudioStyle: string;

  currentLocation?: string;
  currentTimeOfDay?: string;

  currentWeather?: string;

  previousLastFrameUrl?: string;

  updatedAt?: string;
};

/*
 * =========================================================
 * STORY
 * =========================================================
 */

export type Story = {
  title: string;

  genre: string;
  mood: string;

  setting: string;
  summary: string;

  characters: Character[];

  productionBible: ProductionBible;

  productionMemory?: ProductionMemory;

  /*
   * Alte Pipeline.
   */
  scenes: Scene[];

  /*
   * Neue Pipeline.
   */
  moviePlan?: MoviePlan;

  generationModel?: string;

  creationMode?: VideoCreationMode;
};

export type StoryDraft = {
  title: string;

  genre: string;
  mood: string;

  setting: string;
  summary: string;

  characters: Character[];
};

/*
 * =========================================================
 * AI DIRECTOR
 * =========================================================
 */

export type AiDirectorResult = {
  reply: string;

  ready: boolean;

  finished?: boolean;

  story: StoryDraft;
};

/*
 * =========================================================
 * STORY ARCHITECT
 * =========================================================
 */

export type StoryArchitectResult = {
  story: Story;
};

/*
 * =========================================================
 * PROMPT ENGINEER
 * =========================================================
 */

export type PromptEngineerRequest = {
  story: Story;

  scene: Scene;

  previousScene?: Scene | null;
  nextScene?: Scene | null;

  productionMemory?: ProductionMemory;
};

export type PromptEngineerResult = {
  sceneId: number;

  veoPrompt: string;

  audioPrompt: string;
  negativePrompt: string;

  dialogue?: SceneDialogue;

  camera?: string;
  lighting?: string;

  transition?: string;
  style?: string;

  productionMemoryUpdate?: ProductionMemory;
};

/*
 * =========================================================
 * STANDARD VIDEO
 * =========================================================
 */

export type GenerateVideoDialogue = {
  enabled: boolean;

  speaker: string;
  text: string;

  language: string;
  voiceDirection: string;
};

export type GenerateVideoRequest = {
  prompt: string;

  audioPrompt?: string;
  negativePrompt?: string;

  dialogue?: GenerateVideoDialogue;

  referenceImageUrl?: string;

  previousLastFrameUrl?: string;

  sceneId?: number;
};

/*
 * =========================================================
 * VIDEO EXTENSION
 * =========================================================
 */

export type ExtendVideoRequest = {
  videoUri: string;

  prompt: string;

  mimeType?: string;

  extensionNumber?: number;
};

export type ExtendVideoResult = {
  success: boolean;

  operationName?: string;

  model?: string;

  done?: boolean;

  message?: string;
  error?: string;
};

/*
 * Gesamter Auftrag zur Erstellung des Videos.
 */
export type VideoGenerationRequest = {
  openingPrompt: string;

  openingAudioPrompt?: string;
  openingNegativePrompt?: string;

  openingDialogue?: GenerateVideoDialogue;

  continuationPrompts: string[];

  targetDurationSeconds?: VideoDurationSeconds;

  aspectRatio?: VideoAspectRatio;
  editingStyle?: VideoEditingStyle;

  provider?: VideoProvider;

  chapters?: VideoChapter[];
};

/*
 * Rückwärtskompatibilität für bestehenden Code.
 */
export type OneMinuteVideoRequest =
  VideoGenerationRequest;

export type VideoGenerationProgressStatus =
  | "idle"
  | "planning"
  | "starting"
  | "generating-opening"
  | "extending"
  | "generating-chapter"
  | "merging-chapters"
  | "trimming"
  | "completed"
  | "failed";

export type OneMinuteVideoProgressStatus =
  VideoGenerationProgressStatus;

export type VideoGenerationProgress = {
  status: VideoGenerationProgressStatus;

  currentStep: number;
  totalSteps: number;

  currentExtension?: number;
  currentChapter?: number;

  approximateDurationSeconds: number;
  targetDurationSeconds?: VideoDurationSeconds;

  aspectRatio?: VideoAspectRatio;
  editingStyle?: VideoEditingStyle;

  progressPercent: number;

  videoUri?: string;

  message?: string;
  error?: string;
};

export type OneMinuteVideoProgress =
  VideoGenerationProgress;

export type VideoGenerationResult = {
  success: boolean;

  videoUri?: string;

  approximateDurationSeconds?: number;
  targetDurationSeconds?: VideoDurationSeconds;

  aspectRatio?: VideoAspectRatio;
  editingStyle?: VideoEditingStyle;

  extensionCount?: number;
  chapterCount?: number;

  provider?: VideoProvider;

  error?: string;
};

export type OneMinuteVideoResult =
  VideoGenerationResult;

/*
 * =========================================================
 * VIDEO JOB
 * =========================================================
 */

export type VideoJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export type VideoJob = {
  id: string;

  status: VideoJobStatus;

  prompt: string;

  sceneId?: number;

  extensionNumber?: number;

  operationName?: string;

  videoUrl?: string;
  videoUri?: string;

  referenceImageUrl?: string;

  firstFrameUrl?: string;
  lastFrameUrl?: string;

  approximateDurationSeconds?: number;

  targetDurationSeconds?: VideoDurationSeconds;

  aspectRatio?: VideoAspectRatio;
  editingStyle?: VideoEditingStyle;

  provider?: VideoProvider;

  chapterNumber?: number;

  error?: string;

  createdAt: string;
  updatedAt?: string;
};

/*
 * =========================================================
 * VIDEO MERGE
 * =========================================================
 */

export type MergeVideoRequest = {
  videoUrls: string[];

  outputFileName?: string;
};

export type MergeVideoResult = {
  success: boolean;

  videoUrl?: string;

  fileName?: string;

  error?: string;
};
