import numpy as np
import mediapipe as mp
import cv2


# landmarks of features from mediapipe
face_points={
"BLUSH_LEFT": [50],
"BLUSH_RIGHT": [280],
"LEFT_EYE": [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7, 33],
"RIGHT_EYE": [362, 298, 384, 385, 386, 387, 388, 466, 263, 249, 390, 373, 374, 380, 381, 382, 362],
"EYELINER_LEFT": [243, 112, 26, 22, 23, 24, 110, 25, 226, 130, 33, 7, 163, 144, 145, 153, 154, 155, 133, 243],
"EYELINER_RIGHT": [463, 362, 382, 381, 380, 374, 373, 390, 249, 263, 359, 446, 255, 339, 254, 253, 252, 256, 341, 463],
"EYESHADOW_LEFT": [226, 247, 30, 29, 27, 28, 56, 190, 243, 173, 157, 158, 159, 160, 161, 246, 33, 130, 226],
"EYESHADOW_RIGHT": [463, 414, 286, 258, 257, 259, 260, 467, 446, 359, 263, 466, 388, 387, 386, 385, 384, 398, 362, 463],
"FACE": [152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10, 338, 297, 332, 284, 251, 389, 454, 323, 401, 361, 435, 288, 397, 365, 379, 378, 400, 377, 152],
"LIP_UPPER": [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 308, 415, 310, 312, 13, 82, 81, 80, 191, 78],
"LIP_LOWER": [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 402, 317, 14, 87, 178, 88, 95, 78, 61],
"EYEBROW_LEFT": [55, 107, 66, 105, 63, 70, 46, 53, 52, 65, 55],
"EYEBROW_RIGHT": [285, 336, 296, 334, 293, 300, 276, 283, 295, 285]
}

# initialize mediapipe functions
mp_face_mesh = mp.solutions.face_mesh
mp_drawing = mp.solutions.drawing_utils


# to display image in cv2 window
def show_image(image: np.array, msg: str = "Loaded Image"):
    image_copy = image.copy()
    cv2.imshow(msg, image_copy)
    cv2.waitKey(0)
    cv2.destroyAllWindows()


def read_landmarks(image: np.array):
    landmark_cordinates = {}
    # load mediapipe facemesh and detect facial landmarks
    # face landmarks returns normalized points of all facial landmarks from 0 to 477
    with mp_face_mesh.FaceMesh(refine_landmarks=True) as face_mesh:
        results = face_mesh.process(image)
        face_landmarks = results.multi_face_landmarks[0].landmark

    # convert normalized points w.r.to image dimensions
    for idx, landmark in enumerate(face_landmarks):
        landmark_px = mp_drawing._normalized_to_pixel_coordinates(
            landmark.x, landmark.y, image.shape[1], image.shape[0]
        )
        # create a map of facial landmarks to (x,y) coordinates
        if landmark_px:
            landmark_cordinates[idx] = landmark_px
    return landmark_cordinates

def draw_blush_gradient(mask: np.array, center: tuple, radius: int, color: list):
    patch_size = 2 * radius + 1
    # Create a grid of distances from the center of the patch
    y, x = np.ogrid[-radius:radius+1, -radius:radius+1]
    distance = np.sqrt(x*x + y*y)
    # Compute a weight that is 1 at the center and 0 at the edge
    weight = np.clip(1 - distance / radius, 0, 1)
    # Create a patch image for each color channel
    patch = np.zeros((patch_size, patch_size, 3), dtype=np.uint8)
    for c in range(3):
        patch[:, :, c] = (color[c] * weight).astype(np.uint8)
    
    # Determine where to place the patch in the main mask
    x_center, y_center = center
    x0 = x_center - radius
    y0 = y_center - radius
    x1 = x_center + radius + 1
    y1 = y_center + radius + 1

    # Handle boundaries of the main mask
    mask_y0 = max(0, y0)
    mask_x0 = max(0, x0)
    mask_y1 = min(mask.shape[0], y1)
    mask_x1 = min(mask.shape[1], x1)

    patch_y0 = mask_y0 - y0
    patch_x0 = mask_x0 - x0
    patch_y1 = patch_y0 + (mask_y1 - mask_y0)
    patch_x1 = patch_x0 + (mask_x1 - mask_x0)

    # Blend the gradient patch into the mask
    patch_region = patch[patch_y0:patch_y1, patch_x0:patch_x1]
    mask[mask_y0:mask_y1, mask_x0:mask_x1] = cv2.add(
        mask[mask_y0:mask_y1, mask_x0:mask_x1], patch_region
    )

def add_mask(mask: np.array, idx_to_coordinates: dict, face_connections: list, colors: list):
    for i, connection in enumerate(face_connections):
        # If this connection corresponds to FOUNDATION, draw it with lower opacity.
        if connection == face_points["FACE"]:
            points = np.array([idx_to_coordinates[idx] for idx in connection if idx in idx_to_coordinates])
            if points.size > 0:
                foundation_overlay = np.zeros_like(mask)
                cv2.fillPoly(foundation_overlay, [points], colors[i])
                # Use a lower alpha (e.g., 0.4) for foundation
                mask = cv2.addWeighted(mask, 1.0, foundation_overlay, 0.4, 0)
        elif len(connection) == 1 and connection[0] in (50, 280):  # Blush points
            center = idx_to_coordinates.get(connection[0])
            if center:
                blush_overlay = np.zeros_like(mask)
                draw_blush_gradient(blush_overlay, center, radius=30, color=colors[i])
                # Use an alpha of 0.5 to make blush transparent.
                mask = cv2.addWeighted(mask, 1.0, blush_overlay, 0.5, 0)
        elif len(connection) < 3:
            point = idx_to_coordinates.get(connection[0])
            if point:
                cv2.circle(mask, point, radius=15, color=colors[i], thickness=-1)
        else:
            points = np.array([idx_to_coordinates[idx] for idx in connection if idx in idx_to_coordinates])
            if points.size > 0:
                cv2.fillPoly(mask, [points], colors[i])
    mask = cv2.GaussianBlur(mask, (7, 7), 4)
    return mask

def parse_all_hex_colors(hex_color: str) -> list:
    colors = []
    parts = hex_color.split(',')
    for part in parts:
        candidate = part.strip().lstrip("#")
        if len(candidate) >= 6:
            candidate = candidate[:6].upper()
            try:
                int(candidate, 16)
                colors.append("#" + candidate)
            except ValueError:
                continue
    return colors
