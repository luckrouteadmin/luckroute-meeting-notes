# Local inference components

The installer bundles native executables built from the following pinned upstream sources. Each executable's MIT license is included beside it under `resources/local/<platform>-<arch>/`.

- whisper.cpp: https://github.com/ggml-org/whisper.cpp — MIT; commit `927cfce34f31707e17f2bff35c349632fb9e2c3a`.
- llama.cpp: https://github.com/ggml-org/llama.cpp — MIT; commit `b29c606e28a01b1bc8c1351026a0fa6e616bf6c4`.

Model weights are not included in the installer. They are downloaded only when the user explicitly requests local model setup:

- Whisper small: https://huggingface.co/ggerganov/whisper.cpp — converted OpenAI Whisper weights; MIT. Original: https://github.com/openai/whisper.
- Qwen3-4B Q4_K_M: https://huggingface.co/Qwen/Qwen3-4B-GGUF — Apache License 2.0. License: https://huggingface.co/Qwen/Qwen3-4B-GGUF/blob/main/LICENSE.

Pinned model revisions, sizes and SHA-256 hashes are in `src/core/local-models.cjs`. These are inference-only weights: no remote model code is executed. Initial downloads contact Hugging Face and its CDN; local meeting processing makes no network calls.

# Luckroute artwork

The application reuses the original Luckroute SVG from the company's “Фирменный стиль” materials, supplied through the connected company Drive. Colors are preserved: orange #ED7D23 and blue #0ABEF0. The operating-system icon adds only a white rounded application tile and clear space; the original logo geometry is preserved. These brand assets remain the property of Luckroute.
