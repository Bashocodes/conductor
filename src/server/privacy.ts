import { execFile } from "node:child_process";
import { stat, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
} from "node:path";

const execFileAsync = promisify(execFile);

const EXIFTOOL_CANDIDATES = [
  "/opt/homebrew/bin/exiftool",
  "/usr/local/bin/exiftool",
  "/opt/local/bin/exiftool",
];

const SENSITIVE_METADATA_ARGS = [
  "-EXIF:all",
  "-XMP:all",
  "-IPTC:all",
  "-MakerNotes:all",
  "-Photoshop:all",
  "-ItemList:all",
  "-UserData:all",
  "-QuickTime:GPSCoordinates",
  "-QuickTime:LocationInformation",
  "-QuickTime:Author",
  "-QuickTime:Artist",
  "-QuickTime:Title",
  "-QuickTime:Description",
  "-QuickTime:Comment",
  "-QuickTime:Keywords",
  "-QuickTime:CreationDate",
  "-QuickTime:ContentCreateDate",
];

export type PrivacyMediaKind = "image" | "video";

export interface PrivacyCleanResult {
  sourcePath: string;
  outputPath: string;
  mediaKind: PrivacyMediaKind;
  mimeType: string;
  removedMetadataFields: number;
  verified: true;
  originalPreserved: true;
  mediaReencoded: false;
}

async function findExiftool(): Promise<string | undefined> {
  for (const candidate of EXIFTOOL_CANDIDATES) {
    if (await stat(candidate).then(() => true).catch(() => false)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Builds the sibling filename used for a clean copy.
 *
 * The first copy is `name-clean.ext`; later copies use `name-clean-2.ext`,
 * `name-clean-3.ext`, and so on. The source name and extension are preserved.
 */
export function privacyCleanOutputCandidate(
  sourcePath: string,
  sequence = 1,
): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("The privacy-clean sequence must be a positive integer.");
  }
  const extension = extname(sourcePath);
  const stem = basename(sourcePath, extension);
  const suffix = sequence === 1 ? "-clean" : `-clean-${sequence}`;
  return join(dirname(sourcePath), `${stem}${suffix}${extension}`);
}

async function uniquePrivacyCleanOutputPath(sourcePath: string): Promise<string> {
  for (let sequence = 1; sequence <= 10_000; sequence += 1) {
    const candidate = privacyCleanOutputCandidate(sourcePath, sequence);
    const exists = await stat(candidate).then(() => true).catch(() => false);
    if (!exists) return candidate;
  }
  throw new Error("Could not find an unused privacy-clean filename.");
}

/**
 * ExifTool edits only metadata blocks; it does not decode and re-encode the
 * image or video streams. Images keep orientation and ICC color-profile data
 * because removing either can visibly rotate or recolor an otherwise clean
 * copy. Those are display instructions, not identifying authorship data.
 */
export function exiftoolPrivacyCleanArgs(
  sourcePath: string,
  outputPath: string,
  mediaKind: PrivacyMediaKind,
): string[] {
  return mediaKind === "image"
    ? [
      "-all=",
      "-tagsFromFile", "@",
      "-Orientation",
      "-ICC_Profile",
      "-o", outputPath,
      sourcePath,
    ]
    : [
      "-all=",
      "-o", outputPath,
      sourcePath,
    ];
}

async function inspectMimeType(
  exiftool: string,
  path: string,
): Promise<{ mimeType: string; mediaKind: PrivacyMediaKind }> {
  const { stdout } = await execFileAsync(
    exiftool,
    ["-j", "-FileType", "-MIMEType", path],
    { timeout: 30_000, maxBuffer: 1_000_000 },
  );
  const parsed = JSON.parse(stdout) as Array<{
    MIMEType?: unknown;
  }>;
  const mimeType = parsed[0]?.MIMEType;
  if (typeof mimeType !== "string") {
    throw new Error("ExifTool could not identify the selected file.");
  }
  if (mimeType.startsWith("image/")) return { mimeType, mediaKind: "image" };
  if (mimeType.startsWith("video/")) return { mimeType, mediaKind: "video" };
  throw new Error(
    `Privacy Clean supports images and videos; this file is ${mimeType}.`,
  );
}

function metadataFields(stdout: string): string[] {
  const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>;
  return Object.keys(parsed[0] ?? {}).filter((key) => {
    if (key === "SourceFile") return false;
    // Orientation is deliberately retained so a portrait photo does not turn
    // sideways after its identifying metadata is removed.
    return !key.endsWith(":Orientation");
  });
}

async function inspectSensitiveMetadata(
  exiftool: string,
  path: string,
): Promise<string[]> {
  const { stdout } = await execFileAsync(
    exiftool,
    ["-j", "-a", "-G1", "-s", ...SENSITIVE_METADATA_ARGS, path],
    { timeout: 30_000, maxBuffer: 5_000_000 },
  );
  return metadataFields(stdout);
}

export async function createPrivacyCleanCopy(
  sourcePath: string,
): Promise<PrivacyCleanResult> {
  if (!isAbsolute(sourcePath)) {
    throw new Error("Choose an image or video using an absolute path.");
  }
  const sourceInfo = await stat(sourcePath).catch(() => undefined);
  if (sourceInfo === undefined || !sourceInfo.isFile()) {
    throw new Error("The selected image or video does not exist.");
  }

  const exiftool = await findExiftool();
  if (exiftool === undefined) {
    throw new Error(
      "ExifTool is required for Privacy Clean, but it was not found.",
    );
  }

  const { mimeType, mediaKind } = await inspectMimeType(exiftool, sourcePath);
  const beforeFields = await inspectSensitiveMetadata(exiftool, sourcePath);
  const outputPath = await uniquePrivacyCleanOutputPath(sourcePath);

  try {
    await execFileAsync(
      exiftool,
      exiftoolPrivacyCleanArgs(sourcePath, outputPath, mediaKind),
      { timeout: 300_000, maxBuffer: 5_000_000 },
    );

    const outputInfo = await stat(outputPath).catch(() => undefined);
    if (outputInfo === undefined || !outputInfo.isFile() || outputInfo.size === 0) {
      throw new Error("ExifTool did not create a usable clean copy.");
    }

    const outputType = await inspectMimeType(exiftool, outputPath);
    if (outputType.mediaKind !== mediaKind) {
      throw new Error("The clean copy no longer has the original media type.");
    }

    const remainingFields = await inspectSensitiveMetadata(exiftool, outputPath);
    if (remainingFields.length > 0) {
      throw new Error(
        `Metadata verification found fields that should have been removed: `
        + remainingFields.join(", "),
      );
    }

    return {
      sourcePath,
      outputPath,
      mediaKind,
      mimeType,
      removedMetadataFields: beforeFields.length,
      verified: true,
      originalPreserved: true,
      mediaReencoded: false,
    };
  } catch (error) {
    // A failed verification must never leave an output that looks trustworthy.
    await unlink(outputPath).catch(() => undefined);
    throw error;
  }
}
