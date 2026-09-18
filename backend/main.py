import shutil
import subprocess
import uuid
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Synesthesia Stem Separation API")

UPLOAD_DIR = Path("uploads")
OUTPUT_DIR = Path("separated")
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

# Serve separated stems as static files so the frontend can fetch them
# directly, e.g. http://localhost:8000/stems/htdemucs/mysong/vocals.wav
app.mount("/stems", StaticFiles(directory=OUTPUT_DIR), name="stems")


@app.get("/")
def root():
    return {"status": "ok", "message": "POST an audio file to /separate"}


@app.post("/separate")
async def separate(file: UploadFile = File(...)):
    if not file.filename.lower().endswith((".mp3", ".wav", ".flac", ".m4a")):
        raise HTTPException(400, "Upload an mp3, wav, flac, or m4a file")

    # Unique id so two uploads at once don't overwrite each other
    job_id = str(uuid.uuid4())
    input_path = UPLOAD_DIR / f"{job_id}_{file.filename}"
    with input_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    # Run Demucs as a subprocess. -n htdemucs = the default 4-stem model.
    # -o sets where the separated stems get written.
    result = subprocess.run(
        ["demucs", "-n", "htdemucs", "-o", str(OUTPUT_DIR), str(input_path)],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        raise HTTPException(500, f"Demucs failed: {result.stderr}")

    # Demucs writes to separated/htdemucs/<filename_without_ext>/<stem>.wav
    song_name = input_path.stem
    stem_dir = OUTPUT_DIR / "htdemucs" / song_name

    stems = {}
    for stem_name in ["vocals", "drums", "bass", "other"]:
        stem_path = stem_dir / f"{stem_name}.wav"
        if stem_path.exists():
            stems[stem_name] = f"/stems/htdemucs/{song_name}/{stem_name}.wav"

    if not stems:
        raise HTTPException(500, "Separation ran but no stem files were found")

    return {"job_id": job_id, "stems": stems}