import os
import sys
import uuid
import base64
import zipfile
import tempfile
import shutil
from flask import Flask, request, send_file, jsonify
from lxml import etree

# Include the current directory in sys.path so we can import local modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import libadobe
import libadobeFulfill
import register_ADE_account
import ineptepub

app = Flask(__name__)

def get_private_key_der(session_dir):
    activation_path = libadobe.get_activation_xml_path()
    with open(activation_path, 'rb') as f:
        activationxml = etree.parse(f)
    
    adNS = lambda tag: '{%s}%s' % ('http://ns.adobe.com/adept', tag)
    pk_node = activationxml.find(".//%s" % adNS("privateLicenseKey"))
    if pk_node is None:
        raise Exception("Could not find privateLicenseKey in activation.xml")
        
    key_data = base64.b64decode(pk_node.text)
    return key_data[26:]

@app.route('/api/index', methods=['POST'])
def convert():
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
        
    session_id = str(uuid.uuid4())
    session_dir = os.path.join(tempfile.gettempdir(), session_id)
    os.makedirs(session_dir, exist_ok=True)
    
    try:
        acsm_path = os.path.join(session_dir, "input.acsm")
        file.save(acsm_path)
        
        # Configure libadobe to use the session directory for credentials
        libadobe.update_account_path(session_dir)
        
        # Always register a new anonymous account per session to avoid concurrency issues with credentials
        # (Though we could theoretically reuse them, Serverless is stateless anyway)
        try:
            register_ADE_account.main()
        except SystemExit:
            pass # Ignore exits from register_ADE_account
            
        if not os.path.exists(libadobe.get_activation_xml_path()):
            return jsonify({"error": "Failed to create Adobe credentials."}), 500
            
        success, response_str = libadobeFulfill.fulfill(acsm_path)
        if not success:
            return jsonify({"error": f"Fulfillment failed: {response_str}"}), 500
            
        try:
            response = etree.fromstring(response_str.encode('utf-8'))
        except Exception as e:
            return jsonify({"error": f"Error parsing response: {str(e)}"}), 500
            
        ns = {'adept': 'http://ns.adobe.com/adept', 'dc': 'http://purl.org/dc/elements/1.1/'}
        resource = response.find('.//adept:fulfillmentResult', ns)
        
        if resource is None:
            return jsonify({"error": "Invalid response structure (no fulfillmentResult)"}), 500
            
        # Extract metadata
        title_node = resource.find('.//dc:title', ns)
        title = title_node.text if title_node is not None else "Unknown Book"
        
        src_node = resource.find('.//adept:resourceItemInfo/adept:src', ns)
        if src_node is None:
            return jsonify({"error": "Could not find download URL in response"}), 500
            
        download_url = src_node.text
        
        safe_title = "".join([c for c in title if c.isalpha() or c.isdigit() or c==' ']).strip()
        if not safe_title:
            safe_title = "output_book"
            
        encrypted_filename = os.path.join(session_dir, f"{safe_title}_encrypted.epub")
        decrypted_filename = os.path.join(session_dir, f"{safe_title}.epub")
        
        code = libadobe.sendHTTPRequest_DL2FILE(download_url, encrypted_filename)
        if code != 200:
            return jsonify({"error": f"Download failed with code {code}"}), 500
            
        # Inject license
        try:
            license_token = resource.find('.//adept:licenseToken', ns)
            if license_token is not None:
                rights_xml = etree.Element("{http://ns.adobe.com/adept}rights", nsmap={"adept": "http://ns.adobe.com/adept"})
                from copy import deepcopy
                rights_xml.append(deepcopy(license_token))
                rights_str = '<?xml version="1.0" encoding="UTF-8"?>\n' + etree.tostring(rights_xml, encoding="utf-8", pretty_print=True).decode("utf-8")
                
                with zipfile.ZipFile(encrypted_filename, 'a') as zf:
                    if 'META-INF/rights.xml' not in zf.namelist():
                        zf.writestr('META-INF/rights.xml', rights_str)
        except Exception:
            pass # Not fatal
            
        # Decrypt
        userkey = get_private_key_der(session_dir)
        res = ineptepub.decryptBook(userkey, encrypted_filename, decrypted_filename)
        
        if res == 0:
            # Send file back
            return send_file(decrypted_filename, as_attachment=True, download_name=f"{safe_title}.epub")
        elif res == 1:
            return send_file(encrypted_filename, as_attachment=True, download_name=f"{safe_title}.epub")
        else:
            return jsonify({"error": "Decryption failed."}), 500
            
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# Vercel handles the application instance from this file.
if __name__ == '__main__':
    app.run(debug=True, port=3001)
