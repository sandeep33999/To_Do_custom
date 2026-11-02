import math
from PIL import Image, ImageDraw, ImageFilter

def create_zenrhythm_icon(size=1024):
    # Create canvas with RGBA
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    scale = size / 1024.0

    # 1. Background Squircle / Rounded Rectangle
    bg_color = (11, 13, 11, 255) # #0B0D0B
    corner_radius = int(224 * scale)
    draw.rounded_rectangle([(0, 0), (size, size)], radius=corner_radius, fill=bg_color)

    # 2. Subtle Dark Slate / Olive Border
    border_color = (36, 41, 29, 255) # #24291D
    draw.rounded_rectangle([(2, 2), (size - 2, size - 2)], radius=corner_radius, outline=border_color, width=int(14 * scale))

    # Center coordinates
    cx = size / 2.0
    cy = size / 2.0

    # 3. Outer Subtle Orbit Ring
    orbit_radius = int(360 * scale)
    orbit_box = [(cx - orbit_radius, cy - orbit_radius), (cx + orbit_radius, cy + orbit_radius)]
    draw.ellipse(orbit_box, outline=(245, 247, 239, 35), width=int(8 * scale))

    # 4. Circadian Upper Arc (from ~9 o'clock to ~3 o'clock, passing through 12 o'clock)
    # Arc bounding box
    arc_r = int(300 * scale)
    arc_box = [(cx - arc_r, cy - arc_r), (cx + arc_r, cy + arc_r)]
    # Draw arc in 180 to 360 degrees (top half)
    draw.arc(arc_box, start=180, end=0, fill=(185, 229, 76, 255), width=int(38 * scale))

    # Add rounded end caps to arc
    cap_r = int(19 * scale)
    draw.ellipse([(cx - arc_r - cap_r, cy - cap_r), (cx - arc_r + cap_r, cy + cap_r)], fill=(185, 229, 76, 255))
    draw.ellipse([(cx + arc_r - cap_r, cy - cap_r), (cx + arc_r + cap_r, cy + cap_r)], fill=(111, 154, 35, 255))

    # 5. Central Zen Wave (rhythm line)
    # Generate smooth sine points
    wave_points = []
    num_pts = 100
    start_x = cx - 240 * scale
    end_x = cx + 240 * scale
    for i in range(num_pts + 1):
        t = i / float(num_pts)
        wx = start_x + t * (end_x - start_x)
        # Sine wave with 1.5 cycles
        wy = cy + math.sin(t * math.pi * 2.5 - 0.5) * (70 * scale)
        wave_points.append((wx, wy))

    # Draw smooth wave line
    for i in range(len(wave_points) - 1):
        p1 = wave_points[i]
        p2 = wave_points[i+1]
        t = i / float(len(wave_points))
        # Gradient from Lime #B9E54C to Green #6F9A23
        r = int(185 * (1 - t) + 111 * t)
        g = int(229 * (1 - t) + 154 * t)
        b = int(76 * (1 - t) + 35 * t)
        draw.line([p1, p2], fill=(r, g, b, 255), width=int(32 * scale))

    # Caps for wave line
    draw.ellipse([(wave_points[0][0] - 16 * scale, wave_points[0][1] - 16 * scale),
                  (wave_points[0][0] + 16 * scale, wave_points[0][1] + 16 * scale)], fill=(185, 229, 76, 255))
    draw.ellipse([(wave_points[-1][0] - 16 * scale, wave_points[-1][1] - 16 * scale),
                  (wave_points[-1][0] + 16 * scale, wave_points[-1][1] + 16 * scale)], fill=(111, 154, 35, 255))

    # 6. Glowing Zenith Energy Node at Top Peak of Arc (cx, cy - arc_r)
    node_cx = cx
    node_cy = cy - arc_r

    # Glow layer
    glow_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_img)
    glow_r = int(60 * scale)
    glow_draw.ellipse([(node_cx - glow_r, node_cy - glow_r), (node_cx + glow_r, node_cy + glow_r)], fill=(185, 229, 76, 120))
    glow_img = glow_img.filter(ImageFilter.GaussianBlur(radius=int(20 * scale)))
    img = Image.alpha_composite(img, glow_img)
    draw = ImageDraw.Draw(img)

    # Core node circle
    core_r = int(32 * scale)
    draw.ellipse([(node_cx - core_r, node_cy - core_r), (node_cx + core_r, node_cy + core_r)], fill=(185, 229, 76, 255))
    inner_r = int(14 * scale)
    draw.ellipse([(node_cx - inner_r, node_cy - inner_r), (node_cx + inner_r, node_cy + inner_r)], fill=(245, 247, 239, 255))

    return img

def create_round_icon(size=1024):
    img = create_zenrhythm_icon(size)
    # Mask to circular shape for round launcher
    mask = Image.new("L", (size, size), 0)
    draw_mask = ImageDraw.Draw(mask)
    draw_mask.ellipse([(0, 0), (size, size)], fill=255)
    round_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    round_img.paste(img, (0, 0), mask)
    return round_img

# Generate master images at 1024x1024
master = create_zenrhythm_icon(1024)
master_round = create_round_icon(1024)

# Targets
targets = [
    ("android/app/src/main/res/mipmap-mdpi/ic_launcher.png", 48, False),
    ("android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png", 48, True),
    ("android/app/src/main/res/mipmap-hdpi/ic_launcher.png", 72, False),
    ("android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png", 72, True),
    ("android/app/src/main/res/mipmap-xhdpi/ic_launcher.png", 96, False),
    ("android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png", 96, True),
    ("android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png", 144, False),
    ("android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png", 144, True),
    ("android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png", 192, False),
    ("android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png", 192, True),
    ("icons/icon-192.png", 192, False),
    ("icons/icon-512.png", 512, False),
    ("android/app/src/main/assets/icons/icon-192.png", 192, False),
    ("android/app/src/main/assets/icons/icon-512.png", 512, False),
]

for path, sz, is_round in targets:
    src = master_round if is_round else master
    resized = src.resize((sz, sz), Image.Resampling.LANCZOS)
    resized.save(path, format="PNG")
    print(f"Generated {path} ({sz}x{sz})")

print("All icons successfully generated!")
