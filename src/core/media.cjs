"use strict";
const path = require("node:path");
const SUPPORTED_VIDEO_EXTENSIONS = Object.freeze([".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"]);
const SUPPORTED_AUDIO_EXTENSIONS = Object.freeze([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma", ".aiff", ".aif", ".amr"]);
const SUPPORTED_MEDIA_EXTENSIONS = Object.freeze([...SUPPORTED_VIDEO_EXTENSIONS, ...SUPPORTED_AUDIO_EXTENSIONS]);
const includes = (extensions, file) => typeof file === "string" && extensions.includes(path.extname(file).toLowerCase());
const isSupportedVideoPath = (file) => includes(SUPPORTED_VIDEO_EXTENSIONS, file);
const isSupportedAudioPath = (file) => includes(SUPPORTED_AUDIO_EXTENSIONS, file);
const isSupportedMediaPath = (file) => includes(SUPPORTED_MEDIA_EXTENSIONS, file);
const formatsText = (locale = "ru") => locale === "en"
  ? "MP4, MOV, M4V, MKV, AVI and WebM; MP3, WAV, M4A, AAC, FLAC, OGG, OPUS, WMA, AIFF, AIF and AMR"
  : "MP4, MOV, M4V, MKV, AVI и WebM; MP3, WAV, M4A, AAC, FLAC, OGG, OPUS, WMA, AIFF, AIF и AMR";
module.exports = { SUPPORTED_VIDEO_EXTENSIONS, SUPPORTED_AUDIO_EXTENSIONS, SUPPORTED_MEDIA_EXTENSIONS, isSupportedVideoPath, isSupportedAudioPath, isSupportedMediaPath, formatsText };
