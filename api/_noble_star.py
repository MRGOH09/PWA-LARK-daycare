TIER_RULES = [
    {"name": "new-star", "label": "新星", "min": 0},
    {"name": "bronze-star", "label": "青铜星", "min": 10},
    {"name": "silver-star", "label": "白银星", "min": 25},
    {"name": "gold-star", "label": "黄金星", "min": 45},
    {"name": "platinum-star", "label": "铂金星", "min": 70},
    {"name": "diamond-star", "label": "钻石星", "min": 100},
    {"name": "stellar-glory", "label": "星耀", "min": 140},
    {"name": "extraordinary-star", "label": "非凡之星", "min": 190},
]


def score_points(row):
    try:
        return float(row.get("points") or 0)
    except Exception:
        return 0


def score_sum(rows):
    return round(sum(score_points(row) for row in rows), 2)


def tier_payload(points):
    points = float(points or 0)
    current_index = 0
    for index, rule in enumerate(TIER_RULES):
        if points >= rule["min"]:
            current_index = index
    current = TIER_RULES[current_index]
    is_top = current_index == len(TIER_RULES) - 1
    next_rule = None if is_top else TIER_RULES[current_index + 1]
    min_points = float(current["min"])
    next_min = None if is_top else float(next_rule["min"])
    points_to_next = 0 if is_top else max(0, round(next_min - points, 2))
    progress = 100
    subtier = ""
    display_name = current["label"]

    if not is_top:
        span = max(1, next_min - min_points)
        progress = round(max(0, min(100, ((points - min_points) / span) * 100)), 1)
        third = span / 3
        offset = max(0, points - min_points)
        if offset >= third * 2:
            subtier = "I"
        elif offset >= third:
            subtier = "II"
        else:
            subtier = "III"
        display_name = f"{current['label']} {subtier}"

    return {
        "name": current["name"],
        "label": current["label"],
        "subtier": subtier,
        "displayName": display_name,
        "points": round(points, 2),
        "minPoints": round(min_points, 2),
        "nextMinPoints": None if next_min is None else round(next_min, 2),
        "pointsToNext": points_to_next,
        "progressPercent": progress,
        "isTopTier": is_top,
    }
