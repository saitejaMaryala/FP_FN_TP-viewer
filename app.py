import os
import re
from flask import Flask, jsonify, request, send_from_directory, render_template

app = Flask(__name__)

# DATA_ROOT = "/ssd_scratch/sai.teja/tr_test_results_mod"
DATA_ROOT = "/ssd_scratch/sai.teja/yolo_crop_seg_results/FP_FNs_v8l_onVid25"
# ORIGINAL_IMAGES_DIR = "/ssd_scratch/sai.teja/original_images_tr_results_mod"
ORIGINAL_IMAGES_DIR = "/ssd_scratch/sai.teja/Rider_CropSeg_Dataset_vid25/images/val"
# MASK_IMAGES_DIR = "/ssd_scratch/sai.teja/original_images_SAC_tr_results_mod"
MASK_IMAGES_DIR = "/ssd_scratch/sai.teja/yolo_crop_seg_results/gt_val_v8l_onVid25"

# CATEGORIES = ["fn_classified", "fn_unmatched", "fp_classified", "fp_unmatched", "tp_annots"]
CATEGORIES = ["false_positives","false_negatives"]

# Regex: videoId_instanceId_frameNumber[_3r].ext
# e.g. 20211004112233_0060_2519_1485.jpg        → normal
#      2026_02_12_105136_00_2445_1360_3r.jpg    → triple rider
IMG_PATTERN = re.compile(
    r"^(.+)_(\d+)_(\d+)(?:_(3r))?\.(jpg|jpeg|png)$", re.IGNORECASE
)


def parse_image_name(filename):
    """Parse image filename into (video_id, instance_id, frame_num, is_3r, ext)."""
    m = IMG_PATTERN.match(filename)
    if m:
        video_id   = m.group(1)
        instance_id = m.group(2)
        frame_num  = m.group(3)
        is_3r      = m.group(4) is not None  # group 4 is '3r' or None
        ext        = m.group(5)
        return video_id, instance_id, frame_num, is_3r, ext
    return None


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/experiments")
def list_experiments():
    """List all experiment folders in DATA_ROOT."""
    try:
        folders = sorted([
            d for d in os.listdir(DATA_ROOT)
            if os.path.isdir(os.path.join(DATA_ROOT, d))
        ])
        return jsonify({"experiments": folders})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/categories")
def list_categories():
    return jsonify({"categories": CATEGORIES})


@app.route("/api/images")
def get_images():
    """
    Query params:
      - experiments: comma-separated list of experiment folders
      - category: one of CATEGORIES
      - page: page number (1-indexed), default 1
      - per_page: items per page (counted as instances, not frames), default 10
      - search_video: optional filter by video_id substring
      - search_instance: optional filter by instance_id substring

    Returns grouped instances (video_id + instance_id) with frames list.
    Each frame has: frame_num, is_3r, images (by experiment), original_image_url.
    """
    experiments_param = request.args.get("experiments", "")
    category = request.args.get("category", "false_positives")
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 10))
    search_video = request.args.get("search_video", "").strip()
    search_instance = request.args.get("search_instance", "").strip()

    if not experiments_param:
        return jsonify({"error": "No experiments selected"}), 400

    if category not in CATEGORIES:
        return jsonify({"error": f"Invalid category: {category}"}), 400

    selected_experiments = [e.strip() for e in experiments_param.split(",") if e.strip()]

    # instance_map: (video_id, instance_id) -> {frame_num -> {exp: (filename, is_3r)}}
    instance_map = {}

    for exp in selected_experiments:
        cat_dir = os.path.join(DATA_ROOT, exp, category)
        if not os.path.isdir(cat_dir):
            continue
        try:
            files = os.listdir(cat_dir)
        except Exception:
            continue

        for f in files:
            parsed = parse_image_name(f)
            if parsed is None:
                continue
            video_id, instance_id, frame_num, is_3r, ext = parsed

            # Apply filters
            if search_video and search_video.lower() not in video_id.lower():
                continue
            if search_instance and search_instance not in instance_id:
                continue

            inst_key = (video_id, instance_id)
            if inst_key not in instance_map:
                instance_map[inst_key] = {}

            if frame_num not in instance_map[inst_key]:
                instance_map[inst_key][frame_num] = {}

            # Store (filename, is_3r) per experiment
            instance_map[inst_key][frame_num][exp] = (f, is_3r)

    # Sort instances by (video_id, instance_id numerically)
    sorted_inst_keys = sorted(
        instance_map.keys(),
        key=lambda k: (k[0], int(k[1]) if k[1].isdigit() else 0)
    )

    total = len(sorted_inst_keys)
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))
    start = (page - 1) * per_page
    end = start + per_page
    page_keys = sorted_inst_keys[start:end]

    results = []
    for (video_id, instance_id) in page_keys:
        frame_map = instance_map[(video_id, instance_id)]

        # Sort frames numerically
        sorted_frames = sorted(
            frame_map.keys(),
            key=lambda fn: int(fn) if fn.isdigit() else 0
        )

        frames = []
        instance_is_3r = False

        for frame_num in sorted_frames:
            exp_data = frame_map[frame_num]

            images_by_exp = {}
            frame_is_3r = False

            for exp in selected_experiments:
                if exp in exp_data:
                    filename, is_3r = exp_data[exp]
                    images_by_exp[exp] = {
                        "filename": filename,
                        "url": f"/images/{exp}/{category}/{filename}",
                        "is_3r": is_3r
                    }
                    if is_3r:
                        frame_is_3r = True
                else:
                    images_by_exp[exp] = None

            if frame_is_3r:
                instance_is_3r = True

            # Original image: {video_id}_{frame_num}.jpg (no instance_id in name)
            original_filename = f"{video_id}_{frame_num}.jpg"
            original_exists = os.path.isfile(
                os.path.join(ORIGINAL_IMAGES_DIR, original_filename)
            )
            original_image_url = f"/original_images/{original_filename}" if original_exists else None

            mask_exists = os.path.isfile(
                os.path.join(MASK_IMAGES_DIR, original_filename)
            )
            mask_image_url = f"/mask_images/{original_filename}" if mask_exists else None

            frames.append({
                "frame_num": frame_num,
                "is_3r": frame_is_3r,
                "images": images_by_exp,
                "original_image_url": original_image_url,
                "mask_image_url": mask_image_url,
                "instance_key": f"{video_id}_{instance_id}_{frame_num}"
            })

        results.append({
            "video_id": video_id,
            "instance_id": instance_id,
            "is_triple_rider": instance_is_3r,
            "frames": frames,
            "group_key": f"{video_id}_{instance_id}"
        })

    return jsonify({
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": total_pages,
        "experiments": selected_experiments,
        "category": category,
        "results": results
    })


@app.route("/images/<experiment>/<category>/<filename>")
def serve_image(experiment, category, filename):
    """Serve image files from the data root."""
    directory = os.path.join(DATA_ROOT, experiment, category)
    return send_from_directory(directory, filename)


@app.route("/original_images/<filename>")
def serve_original_image(filename):
    """Serve original (no-overlay) frames from ORIGINAL_IMAGES_DIR."""
    return send_from_directory(ORIGINAL_IMAGES_DIR, filename)


@app.route("/mask_images/<filename>")
def serve_mask_image(filename):
    """Serve mask frames from MASK_IMAGES_DIR."""
    return send_from_directory(MASK_IMAGES_DIR, filename)


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
