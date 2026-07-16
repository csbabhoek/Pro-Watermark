"""
Generator ikon PNG untuk Pro Watermark Camera.
Menggambar ulang desain icon.svg (kamera minimalis + lensa ala Hasselblad)
menggunakan Pillow, karena tidak ada delegate rsvg di lingkungan build ini.
Base canvas 512x512, lalu diresize ke tiap ukuran target.
"""
from PIL import Image, ImageDraw

BASE = 512
GOLD = (212, 175, 55, 255)   # #D4AF37
DARK = (17, 17, 17, 255)     # #111111

def draw_camera(draw, scale=1.0, offset=(0, 0)):
    """Menggambar bentuk kamera (badan + viewfinder + lensa) pada koordinat 512 dasar."""
    ox, oy = offset

    def pt(x, y):
        return (ox + x * scale, oy + y * scale)

    line_w = max(1, round(14 * scale))

    # Badan kamera (rounded rect)
    body_box = [pt(76, 176), pt(436, 432)]
    draw.rounded_rectangle(
        [body_box[0][0], body_box[0][1], body_box[1][0], body_box[1][1]],
        radius=36 * scale, outline=GOLD, width=line_w
    )

    # Viewfinder bump (trapesium di atas badan)
    viewfinder = [pt(196, 176), pt(214, 130), pt(298, 130), pt(316, 176)]
    draw.line(viewfinder, fill=GOLD, width=line_w, joint="curve")

    # Lensa: 2 lingkaran konsentris + titik tengah
    cx, cy = pt(256, 308)
    for r, w in [(86, round(14 * scale)), (48, round(12 * scale))]:
        rr = r * scale
        draw.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=GOLD, width=max(1, w))
    r_dot = 14 * scale
    draw.ellipse([cx - r_dot, cy - r_dot, cx + r_dot, cy + r_dot], fill=GOLD)

    # Indikator kecil (flash)
    fx, fy = pt(384, 214)
    r_flash = 10 * scale
    draw.ellipse([fx - r_flash, fy - r_flash, fx + r_flash, fy + r_flash], fill=GOLD)


def make_standard_icon(size):
    img = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Background dengan sudut membulat
    draw.rounded_rectangle([0, 0, BASE, BASE], radius=96, fill=DARK)
    draw_camera(draw, scale=1.0, offset=(0, 0))
    return img.resize((size, size), Image.LANCZOS)


def make_maskable_icon(size):
    img = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Background PENUH tanpa rounded corner & tanpa transparansi (wajib utk maskable)
    draw.rectangle([0, 0, BASE, BASE], fill=DARK)
    # Perkecil & pusatkan konten ke dalam safe zone (~72%)
    scale = 0.72
    content_size = BASE * scale
    offset_val = (BASE - content_size) / 2
    draw_camera(draw, scale=scale, offset=(offset_val, offset_val))
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    standard_sizes = [72, 96, 128, 144, 152, 192, 384, 512]
    for s in standard_sizes:
        make_standard_icon(s).save(f"icon-{s}.png")
        print(f"icon-{s}.png saved")

    for s in [192, 512]:
        make_maskable_icon(s).save(f"icon-maskable-{s}.png")
        print(f"icon-maskable-{s}.png saved")

    print("Selesai.")
