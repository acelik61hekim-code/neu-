import type {
  ProductionBible,
  ProductionMemory,
  Scene,
} from "@/types/story";

/**
 * Zentrale Laufzeitverwaltung für die visuelle Kontinuität.
 *
 * Der Manager verändert niemals das übergebene Originalobjekt.
 * Jede öffentliche Update-Funktion gibt eine tiefe Kopie zurück.
 *
 * WICHTIG:
 * Diese Datei speichert nur Produktionszustand. Sie übergibt noch keine
 * Bildreferenz an Veo. lastFrameUrl und referenceImageUrl werden lediglich
 * für die spätere Nutzung aufbewahrt.
 */

type UnknownRecord = Record<string, unknown>;

export type FrameReferences = {
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  referenceImageUrl?: string;
  videoUri?: string;
};

export type CharacterStateUpdate = {
  characterId: string;
  currentLocation?: string;
  currentPosition?: string;
  currentPose?: string;
  currentExpression?: string;
  currentClothing?: string;
  currentAccessories?: string;
  currentCondition?: string;
  heldProps?: string[];
  visible?: boolean;
};

export type LocationStateUpdate = {
  locationId?: string;
  locationName: string;
  environmentState?: string;
  lightingState?: string;
  weatherState?: string;
  timeOfDay?: string;
  activeCharacters?: string[];
  activeProps?: string[];
};

export type PropStateUpdate = {
  propId?: string;
  propName: string;
  currentOwner?: string;
  currentLocation?: string;
  currentPosition?: string;
  currentCondition?: string;
  visible?: boolean;
};

export type SceneCompletionUpdate = FrameReferences & {
  scene: Scene;
  characterUpdates?: CharacterStateUpdate[];
  locationUpdate?: LocationStateUpdate;
  propUpdates?: PropStateUpdate[];
  completedAt?: string;
};

export type AttachFrameReferencesInput = FrameReferences & {
  sceneId: number;
};

function isRecord(value: unknown): value is UnknownRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function asRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function asString(
  value: unknown,
  fallback = "",
): string {
  return typeof value === "string"
    ? value
    : fallback;
}

function asNumber(
  value: unknown,
  fallback = 0,
): number {
  return typeof value === "number" &&
    Number.isFinite(value)
    ? value
    : fallback;
}

function asBoolean(
  value: unknown,
  fallback = false,
): boolean {
  return typeof value === "boolean"
    ? value
    : fallback;
}

function asArray<T>(
  value: unknown,
): T[] {
  return Array.isArray(value)
    ? (value as T[])
    : [];
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("de-DE");
}

function createStableId(
  prefix: string,
  value: string,
): string {
  const normalized = normalizeKey(value)
    .replace(/[^a-z0-9äöüß]+/gi, "-")
    .replace(/^-+|-+$/g, "");

  return `${prefix}-${normalized || "unknown"}`;
}

function mergeDefined(
  base: UnknownRecord,
  update: UnknownRecord,
): UnknownRecord {
  const result: UnknownRecord = {
    ...base,
  };

  for (const [key, value] of Object.entries(
    update,
  )) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Erstellt eine echte tiefe Kopie.
 * structuredClone wird bevorzugt; JSON ist der Fallback für ältere Laufzeiten.
 */
export function cloneProductionMemory(
  memory: ProductionMemory,
): ProductionMemory {
  if (
    typeof structuredClone === "function"
  ) {
    return structuredClone(memory);
  }

  return JSON.parse(
    JSON.stringify(memory),
  ) as ProductionMemory;
}

function getCharacterBibleEntries(
  productionBible: ProductionBible,
): UnknownRecord[] {
  const bible = asRecord(
    productionBible,
  );

  return asArray<unknown>(
    bible.characterBible,
  )
    .filter(isRecord);
}

function getVisualBible(
  productionBible: ProductionBible,
): UnknownRecord {
  return asRecord(
    asRecord(productionBible).visualBible,
  );
}

function getCameraBible(
  productionBible: ProductionBible,
): UnknownRecord {
  return asRecord(
    asRecord(productionBible).cameraBible,
  );
}

function getAudioBible(
  productionBible: ProductionBible,
): UnknownRecord {
  return asRecord(
    asRecord(productionBible).audioBible,
  );
}

function createCharacterMemory(
  entry: UnknownRecord,
  createdAt: string,
): UnknownRecord {
  const id =
    asString(entry.id) ||
    createStableId(
      "character",
      asString(entry.name, "character"),
    );

  return {
    id,
    characterId: id,
    name: asString(entry.name),
    role: asString(entry.role),

    fixedAppearance:
      asString(entry.fixedAppearance),
    faceIdentity:
      asString(entry.faceIdentity),
    hair: asString(entry.hair),
    eyes: asString(entry.eyes),
    bodyType: asString(entry.bodyType),
    movementStyle:
      asString(entry.movementStyle),
    voiceIdentity:
      asString(entry.voiceIdentity),

    currentLocation: "",
    currentPosition: "",
    currentPose: "",
    currentExpression: "",
    currentClothing:
      asString(entry.clothing),
    currentAccessories:
      asString(entry.accessories),
    currentCondition: "",
    heldProps: [],
    visible: true,

    lastUpdatedSceneId: 0,
    updatedAt: createdAt,
  };
}

function createLocationMemories(
  scenes: Scene[],
  createdAt: string,
): UnknownRecord[] {
  const locations =
    new Map<string, UnknownRecord>();

  for (const scene of scenes) {
    const name =
      asString(
        asRecord(scene).location,
      ).trim();

    if (!name) {
      continue;
    }

    const key = normalizeKey(name);

    if (locations.has(key)) {
      continue;
    }

    locations.set(key, {
      id: createStableId(
        "location",
        name,
      ),
      locationId: createStableId(
        "location",
        name,
      ),
      name,
      locationName: name,
      environmentState: "",
      lightingState: "",
      weatherState: "",
      timeOfDay: "",
      activeCharacters: [],
      activeProps: [],
      lastUpdatedSceneId: 0,
      updatedAt: createdAt,
    });
  }

  return [...locations.values()];
}

function createSceneContinuityEntries(
  scenes: Scene[],
  createdAt: string,
): UnknownRecord[] {
  return scenes.map((scene) => {
    const record = asRecord(scene);

    return {
      sceneId: asNumber(record.id),
      status: "planned",
      startFrame:
        asString(record.startFrame),
      endingFrame:
        asString(record.endingFrame),
      characterStateAtStart:
        asString(
          record.characterStateAtStart,
        ),
      characterStateAtEnd:
        asString(
          record.characterStateAtEnd,
        ),
      environmentStateAtStart:
        asString(
          record.environmentStateAtStart,
        ),
      environmentStateAtEnd:
        asString(
          record.environmentStateAtEnd,
        ),
      cameraStateAtStart:
        asString(
          record.cameraStateAtStart,
        ),
      cameraStateAtEnd:
        asString(
          record.cameraStateAtEnd,
        ),
      lightingState:
        asString(record.lightingState),
      continuityNotes:
        asString(record.continuityNotes),
      firstFrameUrl: undefined,
      lastFrameUrl: undefined,
      referenceImageUrl: undefined,
      videoUri: undefined,
      completedAt: undefined,
      updatedAt: createdAt,
    };
  });
}

/**
 * Erstellt den initialen ProductionMemory aus Production Bible und Szenen.
 */
export function createInitialProductionMemory(
  productionBible: ProductionBible,
  scenes: Scene[],
): ProductionMemory {
  const createdAt = nowIso();
  const visualBible =
    getVisualBible(productionBible);
  const cameraBible =
    getCameraBible(productionBible);
  const audioBible =
    getAudioBible(productionBible);

  const memory: UnknownRecord = {
    version: 1,
    createdAt,
    updatedAt: createdAt,

    currentSceneId:
      scenes[0]?.id ?? 1,
    lastCompletedSceneId: 0,

    globalVisualStyle:
      asString(visualBible.visualStyle),
    globalColorGrade:
      asString(visualBible.colorGrade),
    globalCameraLanguage: [
      asString(cameraBible.cameraStyle),
      asString(cameraBible.lensStyle),
      asString(cameraBible.motionStyle),
    ]
      .filter(Boolean)
      .join("; "),
    globalLightingStyle:
      asString(visualBible.lightingStyle),
    globalAudioStyle: [
      asString(audioBible.ambienceStyle),
      asString(audioBible.musicStyle),
    ]
      .filter(Boolean)
      .join("; "),

    previousLastFrameUrl: undefined,
    lastFrameUrl: undefined,
    firstFrameUrl: undefined,

    characters:
      getCharacterBibleEntries(
        productionBible,
      ).map((entry) =>
        createCharacterMemory(
          entry,
          createdAt,
        ),
      ),

    locations:
      createLocationMemories(
        scenes,
        createdAt,
      ),

    props: [],

    sceneContinuity:
      createSceneContinuityEntries(
        scenes,
        createdAt,
      ),
  };

  return memory as unknown as ProductionMemory;
}

function findCharacterIndex(
  characters: UnknownRecord[],
  characterId: string,
): number {
  const normalized =
    normalizeKey(characterId);

  return characters.findIndex(
    (character) =>
      normalizeKey(
        asString(
          character.characterId,
          asString(character.id),
        ),
      ) === normalized ||
      normalizeKey(
        asString(character.name),
      ) === normalized,
  );
}

/**
 * Aktualisiert genau einen Charakterzustand.
 */
export function updateCharacterState(
  memory: ProductionMemory,
  update: CharacterStateUpdate,
  sceneId?: number,
): ProductionMemory {
  const next =
    cloneProductionMemory(memory);
  const record =
    asRecord(next);
  const characters =
    asArray<UnknownRecord>(
      record.characters,
    ).map((item) => ({
      ...asRecord(item),
    }));

  const index =
    findCharacterIndex(
      characters,
      update.characterId,
    );

  const updateRecord: UnknownRecord = {
    currentLocation:
      update.currentLocation,
    currentPosition:
      update.currentPosition,
    currentPose:
      update.currentPose,
    currentExpression:
      update.currentExpression,
    currentClothing:
      update.currentClothing,
    currentAccessories:
      update.currentAccessories,
    currentCondition:
      update.currentCondition,
    heldProps:
      update.heldProps,
    visible:
      update.visible,
    lastUpdatedSceneId:
      sceneId,
    updatedAt: nowIso(),
  };

  if (index >= 0) {
    characters[index] =
      mergeDefined(
        characters[index],
        updateRecord,
      );
  } else {
    characters.push(
      mergeDefined(
        {
          id: update.characterId,
          characterId:
            update.characterId,
          name: update.characterId,
          heldProps: [],
          visible: true,
        },
        updateRecord,
      ),
    );
  }

  record.characters = characters;
  record.updatedAt = nowIso();

  return record as unknown as ProductionMemory;
}

function findLocationIndex(
  locations: UnknownRecord[],
  update: LocationStateUpdate,
): number {
  const keys = [
    update.locationId,
    update.locationName,
  ]
    .filter(
      (value): value is string =>
        Boolean(value),
    )
    .map(normalizeKey);

  return locations.findIndex(
    (location) => {
      const candidates = [
        asString(location.id),
        asString(location.locationId),
        asString(location.name),
        asString(location.locationName),
      ].map(normalizeKey);

      return keys.some((key) =>
        candidates.includes(key),
      );
    },
  );
}

/**
 * Aktualisiert den Zustand eines Drehortes.
 */
export function updateLocationState(
  memory: ProductionMemory,
  update: LocationStateUpdate,
  sceneId?: number,
): ProductionMemory {
  const next =
    cloneProductionMemory(memory);
  const record =
    asRecord(next);
  const locations =
    asArray<UnknownRecord>(
      record.locations,
    ).map((item) => ({
      ...asRecord(item),
    }));

  const index =
    findLocationIndex(
      locations,
      update,
    );

  const id =
    update.locationId ??
    createStableId(
      "location",
      update.locationName,
    );

  const updateRecord: UnknownRecord = {
    id,
    locationId: id,
    name: update.locationName,
    locationName:
      update.locationName,
    environmentState:
      update.environmentState,
    lightingState:
      update.lightingState,
    weatherState:
      update.weatherState,
    timeOfDay:
      update.timeOfDay,
    activeCharacters:
      update.activeCharacters,
    activeProps:
      update.activeProps,
    lastUpdatedSceneId:
      sceneId,
    updatedAt: nowIso(),
  };

  if (index >= 0) {
    locations[index] =
      mergeDefined(
        locations[index],
        updateRecord,
      );
  } else {
    locations.push(
      mergeDefined(
        {
          activeCharacters: [],
          activeProps: [],
        },
        updateRecord,
      ),
    );
  }

  record.locations = locations;
  record.updatedAt = nowIso();

  return record as unknown as ProductionMemory;
}

function findPropIndex(
  props: UnknownRecord[],
  update: PropStateUpdate,
): number {
  const keys = [
    update.propId,
    update.propName,
  ]
    .filter(
      (value): value is string =>
        Boolean(value),
    )
    .map(normalizeKey);

  return props.findIndex((prop) => {
    const candidates = [
      asString(prop.id),
      asString(prop.propId),
      asString(prop.name),
      asString(prop.propName),
    ].map(normalizeKey);

    return keys.some((key) =>
      candidates.includes(key),
    );
  });
}

/**
 * Aktualisiert oder erstellt eine Requisite.
 */
export function updatePropState(
  memory: ProductionMemory,
  update: PropStateUpdate,
  sceneId?: number,
): ProductionMemory {
  const next =
    cloneProductionMemory(memory);
  const record =
    asRecord(next);
  const props =
    asArray<UnknownRecord>(
      record.props,
    ).map((item) => ({
      ...asRecord(item),
    }));

  const index =
    findPropIndex(
      props,
      update,
    );

  const id =
    update.propId ??
    createStableId(
      "prop",
      update.propName,
    );

  const updateRecord: UnknownRecord = {
    id,
    propId: id,
    name: update.propName,
    propName: update.propName,
    currentOwner:
      update.currentOwner,
    currentLocation:
      update.currentLocation,
    currentPosition:
      update.currentPosition,
    currentCondition:
      update.currentCondition,
    visible:
      update.visible,
    lastUpdatedSceneId:
      sceneId,
    updatedAt: nowIso(),
  };

  if (index >= 0) {
    props[index] =
      mergeDefined(
        props[index],
        updateRecord,
      );
  } else {
    props.push(
      mergeDefined(
        {
          visible: true,
        },
        updateRecord,
      ),
    );
  }

  record.props = props;
  record.updatedAt = nowIso();

  return record as unknown as ProductionMemory;
}

function upsertSceneContinuity(
  memory: ProductionMemory,
  scene: Scene,
  update: UnknownRecord,
): ProductionMemory {
  const next =
    cloneProductionMemory(memory);
  const record =
    asRecord(next);
  const entries =
    asArray<UnknownRecord>(
      record.sceneContinuity,
    ).map((item) => ({
      ...asRecord(item),
    }));

  const sceneRecord =
    asRecord(scene);
  const sceneId =
    asNumber(sceneRecord.id);

  const index =
    entries.findIndex(
      (entry) =>
        asNumber(entry.sceneId, -1) ===
        sceneId,
    );

  const base: UnknownRecord = {
    sceneId,
    startFrame:
      asString(sceneRecord.startFrame),
    endingFrame:
      asString(sceneRecord.endingFrame),
    characterStateAtStart:
      asString(
        sceneRecord.characterStateAtStart,
      ),
    characterStateAtEnd:
      asString(
        sceneRecord.characterStateAtEnd,
      ),
    environmentStateAtStart:
      asString(
        sceneRecord.environmentStateAtStart,
      ),
    environmentStateAtEnd:
      asString(
        sceneRecord.environmentStateAtEnd,
      ),
    cameraStateAtStart:
      asString(
        sceneRecord.cameraStateAtStart,
      ),
    cameraStateAtEnd:
      asString(
        sceneRecord.cameraStateAtEnd,
      ),
    lightingState:
      asString(sceneRecord.lightingState),
    continuityNotes:
      asString(sceneRecord.continuityNotes),
  };

  const merged =
    mergeDefined(
      index >= 0
        ? entries[index]
        : base,
      {
        ...base,
        ...update,
        updatedAt: nowIso(),
      },
    );

  if (index >= 0) {
    entries[index] = merged;
  } else {
    entries.push(merged);
    entries.sort(
      (a, b) =>
        asNumber(a.sceneId) -
        asNumber(b.sceneId),
    );
  }

  record.sceneContinuity = entries;
  record.updatedAt = nowIso();

  return record as unknown as ProductionMemory;
}

/**
 * Speichert Frame- und Videoverweise für eine Szene.
 */
export function attachFrameReferences(
  memory: ProductionMemory,
  input: AttachFrameReferencesInput,
): ProductionMemory {
  const next =
    cloneProductionMemory(memory);
  const record =
    asRecord(next);
  const entries =
    asArray<UnknownRecord>(
      record.sceneContinuity,
    ).map((item) => ({
      ...asRecord(item),
    }));

  const index =
    entries.findIndex(
      (entry) =>
        asNumber(entry.sceneId, -1) ===
        input.sceneId,
    );

  const frameUpdate: UnknownRecord = {
    sceneId: input.sceneId,
    firstFrameUrl:
      input.firstFrameUrl,
    lastFrameUrl:
      input.lastFrameUrl,
    referenceImageUrl:
      input.referenceImageUrl ??
      input.lastFrameUrl,
    videoUri:
      input.videoUri,
    updatedAt: nowIso(),
  };

  if (index >= 0) {
    entries[index] =
      mergeDefined(
        entries[index],
        frameUpdate,
      );
  } else {
    entries.push(frameUpdate);
  }

  record.sceneContinuity = entries;

  if (input.firstFrameUrl) {
    record.firstFrameUrl =
      input.firstFrameUrl;
  }

  if (input.lastFrameUrl) {
    record.previousLastFrameUrl =
      asString(
        record.lastFrameUrl,
      ) || undefined;
    record.lastFrameUrl =
      input.lastFrameUrl;
  }

  record.updatedAt = nowIso();

  return record as unknown as ProductionMemory;
}

/**
 * Hauptfunktion nach einer erfolgreich gerenderten Szene.
 *
 * Sie:
 * - markiert die Szene als abgeschlossen,
 * - speichert Video-/Frame-Referenzen,
 * - aktualisiert Charaktere, Ort und Requisiten,
 * - setzt lastCompletedSceneId und currentSceneId.
 */
export function updateAfterScene(
  memory: ProductionMemory,
  input: SceneCompletionUpdate,
): ProductionMemory {
  const sceneRecord =
    asRecord(input.scene);
  const sceneId =
    asNumber(sceneRecord.id);
  const completedAt =
    input.completedAt ?? nowIso();

  let next =
    upsertSceneContinuity(
      memory,
      input.scene,
      {
        status: "completed",
        completedAt,
        firstFrameUrl:
          input.firstFrameUrl,
        lastFrameUrl:
          input.lastFrameUrl,
        referenceImageUrl:
          input.referenceImageUrl ??
          input.lastFrameUrl,
        videoUri:
          input.videoUri,
      },
    );

  next =
    attachFrameReferences(next, {
      sceneId,
      firstFrameUrl:
        input.firstFrameUrl,
      lastFrameUrl:
        input.lastFrameUrl,
      referenceImageUrl:
        input.referenceImageUrl,
      videoUri:
        input.videoUri,
    });

  for (
    const characterUpdate of
    input.characterUpdates ?? []
  ) {
    next =
      updateCharacterState(
        next,
        characterUpdate,
        sceneId,
      );
  }

  if (input.locationUpdate) {
    next =
      updateLocationState(
        next,
        input.locationUpdate,
        sceneId,
      );
  } else {
    const locationName =
      asString(sceneRecord.location);

    if (locationName) {
      next =
        updateLocationState(
          next,
          {
            locationName,
            environmentState:
              asString(
                sceneRecord.environmentStateAtEnd,
              ),
            lightingState:
              asString(
                sceneRecord.lightingState,
              ),
          },
          sceneId,
        );
    }
  }

  for (
    const propUpdate of
    input.propUpdates ?? []
  ) {
    next =
      updatePropState(
        next,
        propUpdate,
        sceneId,
      );
  }

  const finalRecord =
    asRecord(next);

  finalRecord.lastCompletedSceneId =
    Math.max(
      asNumber(
        finalRecord.lastCompletedSceneId,
      ),
      sceneId,
    );

  finalRecord.currentSceneId =
    sceneId + 1;

  finalRecord.currentCharacterState =
    asString(
      sceneRecord.characterStateAtEnd,
    );

  finalRecord.currentEnvironmentState =
    asString(
      sceneRecord.environmentStateAtEnd,
    );

  finalRecord.currentCameraState =
    asString(
      sceneRecord.cameraStateAtEnd,
    );

  finalRecord.currentLightingState =
    asString(
      sceneRecord.lightingState,
    );

  finalRecord.updatedAt = completedAt;

  return finalRecord as unknown as ProductionMemory;
}

/**
 * Markiert eine Szene als fehlgeschlagen, ohne den letzten erfolgreichen
 * Kontinuitätszustand zu überschreiben.
 */
export function markSceneFailed(
  memory: ProductionMemory,
  scene: Scene,
  errorMessage: string,
): ProductionMemory {
  return upsertSceneContinuity(
    memory,
    scene,
    {
      status: "failed",
      errorMessage,
      failedAt: nowIso(),
    },
  );
}

/**
 * Gibt die gespeicherte Kontinuität einer Szene zurück.
 */
export function getSceneContinuity(
  memory: ProductionMemory,
  sceneId: number,
): UnknownRecord | null {
  const entries =
    asArray<UnknownRecord>(
      asRecord(memory).sceneContinuity,
    );

  return (
    entries.find(
      (entry) =>
        asNumber(
          asRecord(entry).sceneId,
          -1,
        ) === sceneId,
    ) ?? null
  );
}

/**
 * Liefert die beste momentan verfügbare Bildreferenz.
 * Die URL wird nur gespeichert; eine Veo-API-Übergabe erfolgt an anderer Stelle.
 */
export function getLatestFrameReference(
  memory: ProductionMemory,
): string | null {
  const record =
    asRecord(memory);

  const direct =
    asString(record.lastFrameUrl);

  if (direct) {
    return direct;
  }

  const entries =
    asArray<UnknownRecord>(
      record.sceneContinuity,
    )
      .slice()
      .sort(
        (a, b) =>
          asNumber(b.sceneId) -
          asNumber(a.sceneId),
      );

  for (const entry of entries) {
    const value =
      asString(
        entry.referenceImageUrl,
      ) ||
      asString(entry.lastFrameUrl);

    if (value) {
      return value;
    }
  }

  return null;
}

/**
 * Kleine Plausibilitätsprüfung vor dem Speichern oder Übergeben an APIs.
 */
export function validateProductionMemory(
  value: unknown,
): value is ProductionMemory {
  if (!isRecord(value)) {
    return false;
  }

  return (
    Array.isArray(value.characters) &&
    Array.isArray(value.locations) &&
    Array.isArray(value.props) &&
    Array.isArray(
      value.sceneContinuity,
    ) &&
    typeof value.globalVisualStyle ===
      "string" &&
    typeof value.globalColorGrade ===
      "string" &&
    typeof value.globalCameraLanguage ===
      "string" &&
    typeof value.globalLightingStyle ===
      "string" &&
    typeof value.globalAudioStyle ===
      "string"
  );
}