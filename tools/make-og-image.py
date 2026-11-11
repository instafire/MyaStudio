"""Generate public/og-image.png (1200x630) for the landing page OG tags.
Branded, no external assets: black background, blue radial glow, DejaVu text.
Run once; the PNG is committed to the repo."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1200, 630
img = Image.new("RGB", (W, H), (0, 0, 0))
d = ImageDraw.Draw(img)

# Blue radial glow, top-right, blurred
glow = Image.new("RGB", (W, H), (0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([700, -260, 1500, 540], fill=(0, 90, 160))
glow = glow.filter(ImageFilter.GaussianBlur(120))
img = Image.blend(img, glow, 0.55)
d = ImageDraw.Draw(img)

# Faint grid
for x in range(0, W, 60):
    d.line([(x, 0), (x, H)], fill=(255, 255, 255, 8), width=1)
for y in range(0, H, 60):
    d.line([(0, y), (W, y)], fill=(255, 255, 255, 8), width=1)

bold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
regular = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
mono = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"

def font(path, size):
    return ImageFont.truetype(path, size)

# Logo mark: blue ring + play triangle
cx, cy, r = 130, 130, 52
d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(0, 153, 255), width=5)
d.polygon([(cx - 14, cy - 22), (cx - 14, cy + 22), (cx + 24, cy)], fill=(255, 255, 255))

d.text((210, 92), "Mya Studio", font=font(bold, 64), fill=(245, 247, 251))
d.text((80, 300), "Interactive Video Maker", font=font(bold, 84), fill=(255, 255, 255))
d.text((80, 410), "Build branching, choose-your-own-adventure", font=font(regular, 40), fill=(167, 175, 189))
d.text((80, 462), "stories in a visual graph editor.", font=font(regular, 40), fill=(167, 175, 189))
d.text((80, 556), "FREE  ·  OPEN SOURCE  ·  NO SIGN-UP", font=font(mono, 26), fill=(46, 179, 255))

img.save("public/og-image.png", "PNG")
print("wrote public/og-image.png", img.size)
