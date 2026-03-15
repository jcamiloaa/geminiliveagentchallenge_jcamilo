"""
Set-of-Marks (SoM) overlay — server-side.

Takes a screenshot (bytes) and a tag_map, draws red numbered circles
on interactive elements, and returns the annotated image as JPEG bytes.
This replaces the browser-side SoM injection from the extension.
"""
import io
from PIL import Image, ImageDraw, ImageFont

# Circle radius and font size for the tag labels
TAG_RADIUS = 12
FONT_SIZE = 14
TAG_COLOR = (220, 38, 38)       # Red-600
TEXT_COLOR = (255, 255, 255)     # White
OUTLINE_COLOR = (180, 20, 20)   # Darker red border


def _get_font(size: int = FONT_SIZE) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Try to load a TTF font, fall back to default."""
    try:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)
    except (OSError, IOError):
        try:
            return ImageFont.truetype("arial.ttf", size)
        except (OSError, IOError):
            return ImageFont.load_default()


def draw_som_overlay(screenshot_bytes: bytes, tag_map: list[dict]) -> bytes:
    """
    Draw red numbered circles on the screenshot at each tag's center.

    Args:
        screenshot_bytes: Raw JPEG/PNG bytes of the screenshot.
        tag_map: List of dicts with at least {id, cx, cy}.

    Returns:
        JPEG bytes of the annotated screenshot.
    """
    img = Image.open(io.BytesIO(screenshot_bytes)).convert("RGB")
    draw = ImageDraw.Draw(img)
    font = _get_font()

    for tag in tag_map:
        tag_id = tag.get("id", 0)
        cx = tag.get("cx", 0)
        cy = tag.get("cy", 0)
        if cx == 0 and cy == 0:
            continue

        r = TAG_RADIUS
        label = str(tag_id)

        # Draw filled circle with outline
        draw.ellipse(
            [cx - r, cy - r, cx + r, cy + r],
            fill=TAG_COLOR,
            outline=OUTLINE_COLOR,
            width=2,
        )

        # Draw the number centered in the circle
        bbox = draw.textbbox((0, 0), label, font=font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        draw.text(
            (cx - tw / 2, cy - th / 2 - 1),
            label,
            fill=TEXT_COLOR,
            font=font,
        )

    # Return as JPEG bytes
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue()
