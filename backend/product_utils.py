import pandas as pd
from pymongo import MongoClient
import ast
import colorsys
from utils import parse_all_hex_colors
import math
from bson import ObjectId

import os
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB")

def connect_to_mongo(uri=MONGO_URI, db_name=MONGO_DB, collection_name="products"):
    client = MongoClient(uri)
    db = client[db_name]
    return db[collection_name]

def read_csv_to_records(csv_file):
    df = pd.read_csv(csv_file)
    return df.to_dict("records")

def insert_records_into_collection(collection, records):
    if records:
        result = collection.insert_many(records)
        return result.inserted_ids
    return None

def extract_unique_shades(collection):
    unique_shades = {}
    for doc in collection.find():
        category = doc.get("category", "unknown")
        product_colors_str = doc.get("product_colors")
        if product_colors_str:
            try:
                # Convert the string representation of the list to an actual list of dictionaries
                product_colors = ast.literal_eval(product_colors_str)
            except Exception as e:
                continue
            if category not in unique_shades:
                unique_shades[category] = set()
            for color in product_colors:
                hex_value = color.get("hex_value")
                if hex_value:
                    unique_shades[category].add(hex_value)
    return unique_shades

def sort_hex_colors_by_lightness(hex_list):
    def hex_to_hls(hex_color):
        # If the string contains commas, split and take the first valid color.
        if "," in hex_color:
            parts = hex_color.split(",")
            hex_color = parts[0].strip()
        hex_color = hex_color.lstrip("#")
        if len(hex_color) != 6:
            raise ValueError(f"Invalid hex color length: {hex_color}")
        r = int(hex_color[0:2], 16) / 255.0
        g = int(hex_color[2:4], 16) / 255.0
        b = int(hex_color[4:6], 16) / 255.0
        return colorsys.rgb_to_hls(r, g, b)  # returns (h, l, s)

    valid_colors = []
    for color in hex_list:
        try:
            _, l, _ = hex_to_hls(color)
            valid_colors.append((color, l))
        except Exception as e:
            print(f"Skipping invalid color {color}: {e}")
    valid_colors_sorted = sorted(valid_colors, key=lambda x: x[1])
    return [color for color, _ in valid_colors_sorted]

def get_unique_shades_by_product_type():
    try:
        collection = connect_to_mongo(collection_name="products")
        result = {
            "Lipstick": set(),
            "Eyebrow": set(),
            "Eyeliner": set(),
            "Eyeshadow": set(),
            "Blush": set(),
            "Foundation": set(),
        }
        for doc in collection.find():
            try:
                product_type = doc.get("product_type", "")
                product_type_lower = product_type.lower()
                category = None
                if "lipstick" in product_type_lower:
                    category = "Lipstick"
                elif "eyebrow" in product_type_lower:
                    category = "Eyebrow"
                elif "eyeliner" in product_type_lower:
                    category = "Eyeliner"
                elif "eyeshadow" in product_type_lower:
                    category = "Eyeshadow"
                elif "blush" in product_type_lower:
                    category = "Blush"
                elif "foundation" in product_type_lower:
                    category = "Foundation"
                if category:
                    product_colors_str = doc.get("product_colors")
                    if product_colors_str:
                        try:
                            product_colors = ast.literal_eval(product_colors_str)
                        except Exception as parse_e:
                            print(f"Error parsing product_colors for document {doc.get('_id')}: {parse_e}")
                            continue
                        for color in product_colors:
                            hex_value = color.get("hex_value")
                            if hex_value:
                                try:
                                    all_colors = parse_all_hex_colors(hex_value)
                                    for c in all_colors:
                                        result[category].add(c)
                                except Exception as e:
                                    print(f"Skipping invalid color {hex_value}: {e}")
                                    continue
            except Exception as doc_e:
                print(f"Error processing document {doc.get('_id')}: {doc_e}")
                continue
        # Convert each set to a sorted list based on lightness.
        return {key: sort_hex_colors_by_lightness(list(value)) for key, value in result.items()}
    except Exception as e:
        error_msg = f"Error in get_unique_shades_by_product_type: {e}"
        print(error_msg)
        return {"error": error_msg}

def sanitize_value(val):
    if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
        return None  # or choose an alternative default value
    return val

def serialize_product(product):
    # Convert ObjectId to string
    if "_id" in product:
        product["_id"] = str(product["_id"])
    # Sanitize each float value in the document
    for key, value in product.items():
        product[key] = sanitize_value(value)
    return product

def get_products_for_makeup(selected_makeup):
    collection = connect_to_mongo(collection_name="products")
    # Initialize result dictionary with categories.
    result = {
        "Lipstick": [],
        "Eyebrow": [],
        "Eyeliner": [],
        "Eyeshadow": [],
        "Blush": [],
        "Foundation": []
    }
    for doc in collection.find():
        product_colors_str = doc.get("product_colors")
        if not product_colors_str:
            continue
        try:
            product_colors = ast.literal_eval(product_colors_str)
        except Exception as e:
            print(f"Error parsing product_colors for {doc.get('_id')}: {e}")
            continue
        product_type = doc.get("product_type", "").lower()
        matched_category = None
        # Check each category based on selected makeup.
        for category, sel_hex in selected_makeup.items():
            sel_hex = sel_hex.lower()
            if category.startswith("LIP") and "lipstick" in product_type:
                if any(sel_hex == color.get("hex_value", "").lower() for color in product_colors):
                    matched_category = "Lipstick"
                    break
            elif category.startswith("EYEBROW") and "eyebrow" in product_type:
                if any(sel_hex == color.get("hex_value", "").lower() for color in product_colors):
                    matched_category = "Eyebrow"
                    break
            elif category.startswith("EYELINER") and "eyeliner" in product_type:
                if any(sel_hex == color.get("hex_value", "").lower() for color in product_colors):
                    matched_category = "Eyeliner"
                    break
            elif category.startswith("EYESHADOW") and "eyeshadow" in product_type:
                if any(sel_hex == color.get("hex_value", "").lower() for color in product_colors):
                    matched_category = "Eyeshadow"
                    break
            elif category.startswith("BLUSH") and "blush" in product_type:
                if any(sel_hex == color.get("hex_value", "").lower() for color in product_colors):
                    matched_category = "Blush"
                    break
            elif category == "FOUNDATION" and "foundation" in product_type:
                if any(sel_hex == color.get("hex_value", "").lower() for color in product_colors):
                    matched_category = "Foundation"
                    break
        if matched_category:
            result[matched_category].append(serialize_product(doc))
    return result

# # Code to transfer data from CSV to the 'products' collection in MongoDB
# csv_file = "products.csv"  # Update with the correct path to your CSV file
# collection = connect_to_mongo(collection_name="products")
# records = read_csv_to_records(csv_file)
# inserted_ids = insert_records_into_collection(collection, records)
