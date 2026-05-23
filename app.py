import os
from flask import Flask, jsonify, request, send_from_directory, render_template

app = Flask(__name__)

DATA_ROOT = "/ssd_scratch/sai.teja/tr_test_results_mod/results_default_Best"
# DATA_ROOT = "/ssd_scratch/sai.teja/yolo_crop_seg_results/FP_FNs_OnlyRiders_v8l_onVid25"
ORIGINAL_IMAGES_DIR = "/ssd_scratch/sai.teja/original_images_tr_results_mod"
# ORIGINAL_IMAGES_DIR = "/ssd_scratch/sai.teja/onlyRider_CropSeg_Dataset_vid25/images/val"
MASK_IMAGES_DIR = "/ssd_scratch/sai.teja/original_images_SAC_tr_results_mod"
# MASK_IMAGES_DIR = "/ssd_scratch/sai.teja/yolo_crop_seg_results/gt_val_OnlyRider_v8l_onVid25"

def get_categories():
    if not os.path.exists(DATA_ROOT):
        return []
    return sorted([d for d in os.listdir(DATA_ROOT) if os.path.isdir(os.path.join(DATA_ROOT, d))])

IMAGE_EXTS = {'.jpg', '.jpeg', '.png'}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/categories")
def list_categories():
    return jsonify({"categories": get_categories()})


@app.route("/api/images")
def get_images():
    """
    Query params:
      - category: one of CATEGORIES
      - page: page number (1-indexed), default 1
      - per_page: items per page, default 10
      - search: optional filter by filename substring

    Returns a flat list of images from DATA_ROOT/<category>/.
    Each image has: filename, prediction_url, original_url, mask_url.
    """
    categories = get_categories()
    default_cat = categories[0] if categories else "none"
    category = request.args.get("category", default_cat)
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 10))
    search = request.args.get("search", "").strip()
    show_3r_only = request.args.get("show_3r_only", "false").lower() == "true"

    if category not in categories:
        return jsonify({"error": f"Invalid category: {category}"}), 400

    cat_dir = os.path.join(DATA_ROOT, category)

    try:
        all_files = [
            f for f in os.listdir(cat_dir)
            if os.path.splitext(f)[1].lower() in IMAGE_EXTS
        ]
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Apply search filter
    if search:
        all_files = [f for f in all_files if search.lower() in f.lower()]

    # Apply 3R filter
    if show_3r_only:
        all_files = [f for f in all_files if f.endswith('_3r.jpg')]

    # Sort filenames
    all_files.sort()

    # Paginate
    total = len(all_files)
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))
    start = (page - 1) * per_page
    end = start + per_page
    page_files = all_files[start:end]

    # Build results
    results = []
    for filename in page_files:
        stem, ext = os.path.splitext(filename)
        is_3r = stem.endswith('_3r')
        if is_3r:
            stem = stem[:-3]
        
        parts = stem.split('_')
        if len(parts) >= 3:
            frame = parts[-1]
            video = '_'.join(parts[:-2])
            original_filename = f"{video}_{frame}{ext}"
        else:
            original_filename = filename

        prediction_url = f"/pred_images/{category}/{filename}"

        original_exists = os.path.isfile(os.path.join(ORIGINAL_IMAGES_DIR, original_filename))
        original_url = f"/original_images/{original_filename}" if original_exists else None

        mask_exists = os.path.isfile(os.path.join(MASK_IMAGES_DIR, original_filename))
        mask_url = f"/mask_images/{original_filename}" if mask_exists else None

        results.append({
            "filename": filename,
            "prediction_url": prediction_url,
            "original_url": original_url,
            "mask_url": mask_url,
        })

    return jsonify({
        "page": page,
        "per_page": per_page,
        "total": total,
        "total_pages": total_pages,
        "category": category,
        "results": results,
    })


@app.route("/pred_images/<category>/<filename>")
def serve_pred_image(category, filename):
    """Serve prediction overlay images from DATA_ROOT/<category>/."""
    directory = os.path.join(DATA_ROOT, category)
    return send_from_directory(directory, filename)


@app.route("/original_images/<filename>")
def serve_original_image(filename):
    """Serve original frames from ORIGINAL_IMAGES_DIR."""
    return send_from_directory(ORIGINAL_IMAGES_DIR, filename)


@app.route("/mask_images/<filename>")
def serve_mask_image(filename):
    """Serve GT mask frames from MASK_IMAGES_DIR."""
    return send_from_directory(MASK_IMAGES_DIR, filename)


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5001)
