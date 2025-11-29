import os
import json
import hashlib

def calculate_md5(filepath):
    """Calculates the MD5 hash of a file."""
    hash_md5 = hashlib.md5()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest().upper()

def main():
    """
    Scans the repository for content files (skins, backgrounds, coverflows)
    and generates a list.json file with metadata for each file.
    """
    content_by_type = {
        "backgrounds": [],
        "coverflows": [],
        "skins": []
    }
    repo_root = 'repo'
    content_types_config = {
        'skins': 'skin',
        'backgrounds': 'bg',
        'coverflows': 'cf'
    }

    print("Starting repository scan...")

    for subdir, type_prefix in content_types_config.items():
        path = os.path.join(repo_root, subdir)
        if not os.path.exists(path):
            print(f"Directory not found: {path}. Skipping.")
            continue

        print(f"Scanning {path}...")
        for filename in os.listdir(path):
            if filename.endswith('.jpg'):
                continue

            filepath = os.path.join(path, filename)
            if not os.path.isfile(filepath):
                continue
            
            parts = filename.split('.')
            if len(parts) < 3:
                print(f"Could not parse filename: {filename}. Skipping.")
                continue

            file_type_prefix = parts[0] # e.g., 'skin', 'cf', 'bg'
            author = parts[1]
            name = ".".join(parts[2:-1]) # Re-join name if it had dots and exclude extension
            
            # Extract extension for comparison
            file_ext = parts[-1] 

            # Special handling for skin version/revision from xzp (if possible, needs to read file)
            version = "1" # Default version, will try to extract for skins later
            
            # Construct the ID
            item_id = f"{file_type_prefix}.{author}.{name}"
            
            try:
                size = os.path.getsize(filepath)
                file_hash = calculate_md5(filepath)
                
                content_item = {
                    "id": item_id,
                    "hash": file_hash,
                    "nombre": name.replace('_', ' '),
                    "autor": author,
                    "archivo": filename,
                    "version": version,
                    "size": size
                }
                
                # Assign to correct array based on subdir
                if subdir == "backgrounds":
                    content_by_type["backgrounds"].append(content_item)
                elif subdir == "coverflows":
                    content_by_type["coverflows"].append(content_item)
                elif subdir == "skins":
                    # For skins, try to extract version/revision from inside the xzp
                    if file_ext == "xzp":
                        try:
                            with open(filepath, 'r', encoding='ISO-8859-1') as f_xzp:
                                xzp_content = f_xzp.read()
                                start_idx = xzp_content.find('{"metaver"')
                                if start_idx != -1:
                                    open_braces = 0
                                    end_idx = -1
                                    for i in range(start_idx, len(xzp_content)):
                                        if xzp_content[i] == '{':
                                            open_braces += 1
                                        elif xzp_content[i] == '}':
                                            open_braces -= 1
                                        if open_braces == 0:
                                            end_idx = i
                                            break
                                    if end_idx != -1:
                                        json_str = xzp_content[start_idx : end_idx + 1]
                                        metadata = json.loads(json_str)
                                        if "revision" in metadata:
                                            content_item["version"] = str(metadata["revision"])
                        except Exception as xzp_e:
                            print(f"Warning: Could not extract metadata from {filename}: {xzp_e}")
                    content_by_type["skins"].append(content_item)
                print(f"Processed: {filename}")

            except Exception as e:
                print(f"Error processing file {filename}: {e}")

    # Sort each list by ID for consistency
    for key in content_by_type:
        content_by_type[key].sort(key=lambda x: x['id'])

    # Write the object to list.json
    output_path = os.path.join(repo_root, 'list.json')
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(content_by_type, f, indent=2)
        print(f"Successfully generated {output_path} with total {sum(len(v) for v in content_by_type.values())} items.")
    except Exception as e:
        print(f"Error writing to {output_path}: {e}")


if __name__ == "__main__":
    main()
